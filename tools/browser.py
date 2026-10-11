import base64
import functools
import http.server
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
NO_NETWORK = """(() => {
  const ownFetch = window.fetch.bind(window);
  const own = (address) => {
    try {
      return new URL(String(address), location.href).origin === location.origin;
    } catch (error) {
      return false;
    }
  };
  window.fetch = (address, options) => {
    if (own(address)) return ownFetch(address, options);
    const stand = window.top.__net;
    return stand ? stand(String(address), options || {}) : Promise.reject(new TypeError('сеть закрыта'));
  };
  window.WebSocket = class {
    constructor(address) {
      this.url = address;
    }

    send() {}

    close() {}
  };
  window.__sealed = true;
})()"""
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
]
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **CONTENT_TYPES}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def serve(directory, port=0, host="127.0.0.1"):
    handler = functools.partial(StaticHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start()
    return server


def find_browser():
    for candidate in BROWSERS:
        path = candidate if Path(candidate).exists() else shutil.which(candidate)
        if path:
            return path
    sys.exit("не найден Edge или Chrome")


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def port_is_open(port):
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


class Browser:
    def __init__(self, width=1280, height=720):
        import websocket

        self.port = free_port()
        self.profile = tempfile.mkdtemp(prefix="slovotron_browser_")
        self.process = subprocess.Popen(
            [find_browser(), "--headless=new", f"--remote-debugging-port={self.port}", "--remote-allow-origins=*",
             f"--user-data-dir={self.profile}", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
             f"--window-size={width},{height}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.socket = None
        self.errors = []
        self._last_id = 0
        page = self._find_page()
        if not page:
            self.close()
            sys.exit("браузер не ответил")
        self.socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=120, suppress_origin=True)
        self.call("Runtime.enable")
        self.set_size(width, height)

    def __enter__(self):
        return self

    def __exit__(self, *error):
        self.close()

    def _find_page(self):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(80):
            try:
                with opener.open(f"http://127.0.0.1:{self.port}/json", timeout=2) as reply:
                    pages = [target for target in json.load(reply) if target["type"] == "page"]
                if pages:
                    return pages[0]
            except OSError:
                pass
            time.sleep(0.25)
        return None

    def call(self, method, **params):
        self._last_id += 1
        self.socket.send(json.dumps({"id": self._last_id, "method": method, "params": params}))
        while True:
            message = json.loads(self.socket.recv())
            if message.get("method") == "Runtime.exceptionThrown":
                details = message["params"]["exceptionDetails"]
                text = details.get("exception", {}).get("description") or details.get("text") or ""
                self.errors.append(f"{text}  ({details.get('url', '')}:{details.get('lineNumber', 0) + 1})")
            if message.get("id") == self._last_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    def navigate(self, url):
        self.call("Page.navigate", url=url)

    def run_in_every_page(self, script):
        self.call("Page.enable")
        self.call("Page.addScriptToEvaluateOnNewDocument", source=script)

    def evaluate(self, expression, wait_promise=False):
        reply = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=wait_promise)
        if "exceptionDetails" in reply:
            details = reply["exceptionDetails"]
            raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
        return reply.get("result", {}).get("value")

    def wait_for(self, expression, timeout=30.0, step=0.1):
        deadline = time.time() + timeout
        while time.time() < deadline:
            value = self.evaluate(expression)
            if value:
                return value
            time.sleep(step)
        raise TimeoutError(f"не дождались: {expression}")

    def set_size(self, width, height):
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)

    def screenshot(self, path, transparent=False):
        if transparent:
            self.call("Emulation.setDefaultBackgroundColorOverride", color={"r": 0, "g": 0, "b": 0, "a": 0})
        else:
            self.call("Emulation.setDefaultBackgroundColorOverride")
        Path(path).write_bytes(base64.b64decode(self.call("Page.captureScreenshot", format="png")["data"]))

    def close(self):
        if self.socket is not None:
            try:
                self.call("Browser.close")
                self.socket.close()
            except Exception:
                pass
            self.socket = None
        for _ in range(40):
            if not port_is_open(self.port):
                break
            time.sleep(0.25)
        try:
            self.process.wait(5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

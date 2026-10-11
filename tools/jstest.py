import json
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))

from browser import NO_NETWORK, ROOT, Browser, serve

PAGE = "/tests/js/tests.html"
FINISHED = "window.__results ? JSON.stringify(window.__results) : (window.__fatal || '')"


def run(only="", timeout=180.0):
    server = serve(ROOT)
    url = f"http://127.0.0.1:{server.server_address[1]}{PAGE}" + (f"?only={quote(only)}" if only else "")
    try:
        with Browser() as browser:
            browser.run_in_every_page(NO_NETWORK)
            browser.navigate(url)
            try:
                output = browser.wait_for(FINISHED, timeout)
            except TimeoutError:
                output = "страница тестов не ответила за отведённое время"
            try:
                result = json.loads(output)
            except ValueError:
                result = {"total": 0, "passed": 0, "failed": [], "fatal": output}
            result["errors"] = list(browser.errors)
            return result
    finally:
        server.shutdown()
        server.server_close()


def report(result):
    for failure in result["failed"]:
        print(f"УПАЛ: {failure['name']}\n    " + str(failure["error"]).replace("\n", "\n    "))
    if result.get("fatal"):
        print("тесты не запустились: " + str(result["fatal"]))
    for error in result["errors"]:
        print("ошибка на странице: " + error)
    print(f"тестов: {result['total']}, прошло: {result['passed']}, упало: {len(result['failed'])}")
    passed = result["total"] and not result["failed"] and not result.get("fatal") and not result["errors"]
    return 0 if passed else 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")
    sys.exit(report(run(sys.argv[1] if len(sys.argv) > 1 else "")))

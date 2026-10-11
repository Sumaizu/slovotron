import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from browser import NO_NETWORK, ROOT, SITE, Browser, serve

DOCS = ROOT / "docs"
CAMERA_PLACEHOLDER = """(() => {
  const camera = document.querySelector('.cam');
  const frame = camera ? camera.getBoundingClientRect() : null;
  if (!frame || !frame.width) return;
  const person = document.createElement('div');
  person.style.cssText = 'position:fixed;z-index:-1;overflow:hidden;border-radius:18px;' +
    'background:linear-gradient(160deg,#50627f,#28334c);' +
    'left:' + frame.left + 'px;top:' + frame.top + 'px;width:' + frame.width + 'px;height:' + frame.height + 'px';
  const shape = 'position:absolute;left:50%;transform:translateX(-50%);background:#8495b3;';
  person.innerHTML = '<div style="' + shape + 'top:20%;width:25%;height:33%;border-radius:50%"></div>' +
    '<div style="' + shape + 'top:60%;width:60%;height:60%;border-radius:50% 50% 0 0"></div>';
  document.body.prepend(person);
})()"""
VICTORY = """(async () => {
  const { demoState } = await import('./js/demo.js');
  const view = window.slovotron.view, state = demoState(window.slovotron.game.s);
  const winner = 'ЛисаАлиса', crowned = (row) => Object.assign(row, { crown: (row.user || row.name) === winner });
  state.state = 'results';
  state.hint_at = null;
  state.words += 1;
  state.closest = 1;
  state.best.unshift({ word: 'костер', rank: 1, user: winner, color: '', star: '', hint: false, rude: false });
  state.feed.push({ id: 100, user: winner, text: 'костёр', color: '', star: '', rank: 1, repeat: false,
    unknown: false, failed: false });
  state.best.forEach(crowned);
  state.feed.forEach(crowned);
  state.top = state.top.map((row) => crowned({ name: row.name, score: row.score + (row.name === winner ? 1 : 0) }));
  state.results = { reason: 'win', round: state.round, at: state.now, next_at: state.now + 14, pause: 20,
    word: 'костер', winner, color: '', star: '', crown: true, seconds: 318 };
  view.render(state);
  view.confetti.start(20);
  return 1;
})()"""
OVERLAY_READY = "window.slovotron && document.querySelectorAll('#best .row').length ? 1 : 0"
PAGE_READY = "document.getElementById('play') && !document.getElementById('play').disabled ? 1 : 0"


def open_overlay(browser, base, query=""):
    browser.set_size(1280, 720)
    browser.navigate(f"{base}/overlay.html?embed=1{'&' + query if query else ''}")
    browser.wait_for(OVERLAY_READY, 30)
    browser.evaluate(CAMERA_PLACEHOLDER)


def shoot_overlay(browser, base, out, query=""):
    open_overlay(browser, base, query)
    time.sleep(0.5)
    browser.screenshot(out, transparent=True)


def shoot_victory(browser, base, out):
    open_overlay(browser, base)
    browser.evaluate(VICTORY, wait_promise=True)
    time.sleep(1.6)
    browser.screenshot(out, transparent=True)


def shoot_page(browser, base, out):
    browser.set_size(1920, 1000)
    browser.navigate(f"{base}/index.html")
    browser.wait_for(PAGE_READY, 30)
    browser.evaluate("document.getElementById('toggle-settings').click()")
    time.sleep(1.0)
    browser.screenshot(out)


def main():
    parser = argparse.ArgumentParser(description="Снимки оверлея и главной страницы для README.")
    parser.add_argument("--out", default=str(DOCS), help="куда сохранить снимки (по умолчанию docs/)")
    out = Path(parser.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    server = serve(SITE)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with Browser() as browser:
            browser.run_in_every_page(NO_NETWORK)
            shoot_overlay(browser, base, out / "overlay.png")
            shoot_overlay(browser, base, out / "overlay-compact.png", "chat=0&side=0")
            shoot_victory(browser, base, out / "overlay-win.png")
            shoot_page(browser, base, out / "page.png")
    finally:
        server.shutdown()
        server.server_close()
    for image in sorted(out.glob("*.png")):
        print(f"{image.name}: {image.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()

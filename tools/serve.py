import sys
import time
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from browser import SITE, port_is_open, serve

PORT = 8771
URL = f"http://127.0.0.1:{PORT}/"


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace", line_buffering=True)
    if port_is_open(PORT):
        print(f"Словотрон уже запущен: {URL}")
        webbrowser.open(URL)
        return 0
    server = serve(SITE, PORT)
    print(f"Словотрон открыт по адресу {URL}")
    print("Чтобы закрыть, нажми Ctrl+C или закрой это окно.")
    webbrowser.open(URL)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nОстановлено.")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

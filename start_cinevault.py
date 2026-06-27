"""
CineVault Launcher
==================
Starts the local CineVault services and opens the application.
"""

import os
import sys
import subprocess
import webbrowser
import time
import socket

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FLASK_PORT = 8090
CINEVAULT_API_PORT = 4000
TORRENT_STREAM_PORT = 9411
ANIMEPAHE_LEGACY_PORT = 3000
URL = f"http://localhost:{FLASK_PORT}"

CREATE_FLAGS = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0


def is_port_open(port):
    """Check if a local port is already open/in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0


def wait_for_port(port, timeout=8):
    """Wait briefly for a service to bind its port."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_port_open(port):
            return True
        time.sleep(0.2)
    return False


def npm_command():
    """Use npm.cmd on Windows to avoid PowerShell execution policy issues."""
    return "npm.cmd" if os.name == 'nt' else "npm"


def start_service(name, port, command, cwd=BASE_DIR, timeout=8):
    """Start a service if its port is not already listening."""
    if is_port_open(port):
        print(f"{name} is already running on port {port}.")
        return True

    print(f"Starting {name} on port {port}...")
    try:
        subprocess.Popen(
            command,
            cwd=cwd,
            creationflags=CREATE_FLAGS
        )
    except FileNotFoundError as exc:
        print(f"Could not start {name}: {exc}")
        return False

    if wait_for_port(port, timeout=timeout):
        print(f"{name} is running.")
        return True

    print(f"{name} did not respond on port {port} within {timeout} seconds.")
    return False

def find_firefox():
    """Locate the Firefox executable on Windows."""
    paths = [
        os.path.join(os.environ.get('ProgramFiles', 'C:\\Program Files'), 'Mozilla Firefox', 'firefox.exe'),
        os.path.join(os.environ.get('ProgramFiles(x86)', 'C:\\Program Files (x86)'), 'Mozilla Firefox', 'firefox.exe'),
        os.path.join(os.environ.get('LocalAppData', ''), 'Mozilla Firefox', 'firefox.exe'),
    ]
    for path in paths:
        if os.path.exists(path):
            return path
    return None

def main():
    print("Starting CineVault launcher...")

    start_service(
        "Flask backend",
        FLASK_PORT,
        [sys.executable, "-X", "utf8", "server.py"],
        cwd=BASE_DIR
    )

    start_service(
        "CineVault provider API",
        CINEVAULT_API_PORT,
        ["node", "server.js"],
        cwd=os.path.join(BASE_DIR, "CineVault-API")
    )

    start_service(
        "WebTorrent stream server",
        TORRENT_STREAM_PORT,
        ["node", "torrent-stream-server.js"],
        cwd=BASE_DIR
    )

    if is_port_open(ANIMEPAHE_LEGACY_PORT):
        print(f"Optional legacy AnimePahe API is running on port {ANIMEPAHE_LEGACY_PORT}.")
    else:
        print("Optional legacy AnimePahe API is not running on port 3000; provider fallback remains available through port 4000.")

    # Find and register Firefox
    firefox_path = find_firefox()
    if firefox_path:
        print(f"Firefox located at: {firefox_path}")
        webbrowser.register('firefox', None, webbrowser.BackgroundBrowser(firefox_path))
        browser = webbrowser.get('firefox')
    else:
        print("Firefox not found in standard paths. Falling back to default system browser.")
        browser = webbrowser

    print(f"Opening {URL}...")
    browser.open(URL)
    print("CineVault is ready!")

if __name__ == '__main__':
    main()

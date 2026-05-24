"""
CineVault Launcher
==================
Starts the Flask server and opens the application in Mozilla Firefox.
"""

import os
import sys
import subprocess
import webbrowser
import time
import socket

PORT = 8090
URL = f"http://localhost:{PORT}"

def is_server_running():
    """Check if the port is already open/in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', PORT)) == 0

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

    # 1. Start the Flask server if it is not already running
    if not is_server_running():
        print("Server is not running. Starting server.py...")
        # Start server as a background process
        subprocess.Popen(
            [sys.executable, "-X", "utf8", "server.py"],
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        )
        # Give it a couple of seconds to spin up
        time.sleep(2)
    else:
        print("Server is already running.")

    # 2. Find and register Firefox
    firefox_path = find_firefox()
    if firefox_path:
        print(f"Firefox located at: {firefox_path}")
        # Register Firefox with python's webbrowser
        webbrowser.register('firefox', None, webbrowser.BackgroundBrowser(firefox_path))
        browser = webbrowser.get('firefox')
    else:
        print("Firefox not found in standard paths. Falling back to default system browser.")
        browser = webbrowser

    # 3. Open the URL
    print(f"Opening {URL}...")
    browser.open(URL)
    print("CineVault is ready!")

if __name__ == '__main__':
    main()

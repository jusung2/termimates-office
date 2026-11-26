#!/usr/bin/env python3
"""TermiMates 웹 사무실 서버 (python3 표준 라이브러리만).

- 127.0.0.1 에서만 열린다. 밖으로 보내는 것 없음.
- 패널(mod)이 적어 두는 사무실 상태 파일(~/.termimates/panel/<세션>.json)을 브라우저로 보낸다.
- 패널이 `/termimates 웹` 으로 켜면 Claude Code 세션 동안만 돈다. 같은 포트에 이미 서버가 있으면 조용히 끝난다.
- 받는 것은 하나: 웹에서 누른 「놓친 일 서류」 id (POST /api/pick) → <세션>.pick 에 한 줄 적어 두면 패널이 읽고 비운다.
  패널은 자기 서류 목록에 있는 id 일 때만 입력창에 문장을 넣는다 (보내지는 않음).
사용: python3 serve.py [--port 8766] [--dir ~/.termimates/panel]
"""
import argparse
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/office.js": ("office.js", "text/javascript; charset=utf-8"),
    "/sprites.js": ("sprites.js", "text/javascript; charset=utf-8"),
    "/office.css": ("office.css", "text/css; charset=utf-8"),
}
DIR = os.path.expanduser("~/.termimates/panel")
PORT = 8766
SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


def snapshots():
    """(수정 시각, 경로) 최신 순. 하루 넘은 건 지운다."""
    out = []
    now = time.time()
    try:
        names = os.listdir(DIR)
    except OSError:
        return out
    for n in names:
        if not n.endswith(".json"):
            continue
        p = os.path.join(DIR, n)
        try:
            m = os.stat(p).st_mtime
        except OSError:
            continue
        if now - m > 86400:
            try:
                os.remove(p)
            except OSError:
                pass
            continue
        out.append((m, p))
    out.sort(reverse=True)
    return out


def pick(session):
    """보여 줄 상태 파일: 고른 세션, 없으면 가장 최근에 바뀐 것."""
    files = snapshots()
    if session and session != "auto":
        for m, p in files:
            if os.path.basename(p) == session + ".json":
                return m, p
    return files[0] if files else (0, None)


def read(p):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def sessions():
    out = []
    for m, p in snapshots():
        try:
            d = json.loads(read(p) or "{}")
        except ValueError:
            continue
        out.append({"session": d.get("session"), "project": d.get("project"), "at": int(m * 1000)})
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # 조용히
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        session = (q.get("session") or ["auto"])[0]
        if u.path in STATIC:
            name, ctype = STATIC[u.path]
            try:
                with open(os.path.join(HERE, name), "rb") as f:
                    return self.send(200, f.read(), ctype)
            except OSError:
                return self.send(404, "not found", "text/plain")
        if u.path == "/api/sessions":
            return self.send(200, json.dumps(sessions(), ensure_ascii=False))
        if u.path == "/api/state":
            _, p = pick(session)
            return self.send(200, (p and read(p)) or "null")
        if u.path == "/api/stream":
            return self.stream(session)
        return self.send(404, "not found", "text/plain")

    def do_POST(self):
        """웹에서 누른 놓친 일 서류: {session, id} → <세션>.pick 에 한 줄 (같은 컴퓨터 이 화면에서 온 것만)"""
        u = urlparse(self.path)
        if u.path != "/api/pick":
            return self.send(404, "not found", "text/plain")
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return self.send(403, '{"ok":false}')
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 2000)
            body = json.loads(self.rfile.read(n) or b"{}")
            session, pid = str(body.get("session") or ""), str(body.get("id") or "")
        except (ValueError, AttributeError):
            return self.send(400, '{"ok":false}')
        if not SAFE.match(session) or not SAFE.match(pid) or session.startswith("."):
            return self.send(400, '{"ok":false}')
        try:
            with open(os.path.join(DIR, session + ".pick"), "a", encoding="utf-8") as f:
                f.write(json.dumps({"id": pid, "at": int(time.time() * 1000)}) + "\n")
        except OSError:
            return self.send(500, '{"ok":false}')
        return self.send(200, '{"ok":true}')

    def stream(self, session):
        """상태 파일이 바뀔 때마다 보낸다 (SSE). 15초마다 살아 있다는 표시."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last = None
        beat = time.time()
        try:
            while True:
                m, p = pick(session)
                key = (p, m)
                if p and key != last:
                    body = read(p)
                    if body:
                        self.wfile.write(b"data: " + body.replace("\n", " ").encode("utf-8") + b"\n\n")
                        self.wfile.flush()
                        last = key
                if time.time() - beat > 15:
                    self.wfile.write(b": keep\n\n")
                    self.wfile.flush()
                    beat = time.time()
                time.sleep(0.12)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return


def main():
    global DIR, PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--dir", default=DIR)
    a = ap.parse_args()
    DIR = os.path.expanduser(a.dir)
    PORT = a.port
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        return 0  # 이미 다른 세션의 서버가 떠 있음 — 그걸 같이 쓴다
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

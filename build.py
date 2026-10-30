"""Builds public/index.html from src/ and data/. Run: python3 build.py"""
import os
from pathlib import Path
root = Path(__file__).parent
page = (root / 'src/template.html').read_text()
engine = (root / 'src/engine.js').read_text()
heroes = (root / 'data/heroes.csv').read_text().strip()
vs = (root / 'data/vs.txt').read_text().replace('\n', '')
syn = (root / 'data/syn.txt').read_text().replace('\n', '')
assert '</script' not in engine
body = (page.replace('/*__ENGINE__*/', engine).replace('/*__HEROES__*/', heroes)
            .replace('/*__VS__*/', vs).replace('/*__SY__*/', syn)
            .replace('__DC_SERVER__', os.environ.get('DC_SERVER', 'wss://draft-clash-rooms.onrender.com')))
shell = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="1v1 Dota 2 Captains Mode draft game. Matches auto-simulate from a year of OpenDota pro data and pause at early, mid and late game.">
<meta name="theme-color" content="#0f1317">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='16' height='32' fill='%2372b55c'/%3E%3Crect x='16' width='16' height='32' fill='%23e0623f'/%3E%3C/svg%3E">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
""" + body + "\n</body>\n</html>\n"
out = root / 'public/index.html'
out.write_text(shell)
print(f'wrote {out} ({len(shell):,} bytes)')

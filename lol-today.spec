# PyInstaller spec — 백엔드를 단일 exe로 번들 (Electron이 spawn)
# 사용: pyinstaller --noconfirm lol-today.spec

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

hidden = (
    collect_submodules('uvicorn')
    + collect_submodules('fastapi')
    + ['web.server', 'web', 'lcu', 'lcu.client', 'lcu.endpoints', 'lcu.errors',
       'settlement', 'settlement.rules', 'settlement.aggregate', 'settlement.friends',
       'data', 'data.ddragon']
)

datas = []
# 정적 자원(index.html, app.js) 포함 — FastAPI StaticFiles가 찾도록
datas += [('web/static', 'web/static')]

a = Analysis(
    ['cli.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

import os as _os
_os.makedirs('dist-py', exist_ok=True)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='lol-today-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # GUI 앱이므로 콘솔창 숨김
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/icon.ico' if __import__('os').path.exists('assets/icon.ico') else None,
)

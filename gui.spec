# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files

# rayoptics needs cie-cmf.txt and other data files in util/
rayoptics_datas = collect_data_files('rayoptics')

a = Analysis(
    ['gui.py'],
    pathex=['.'],
    binaries=[],
    datas=rayoptics_datas,
    hiddenimports=['singlet_rayoptics', 'optics_visualization', 'WebKit'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='gui',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Run from Terminal to see debug: ./dist/gui.app/Contents/MacOS/gui
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
app = BUNDLE(
    exe,
    name='gui.app',
    icon=None,
    bundle_identifier=None,
    info_plist={
        'LSBackgroundOnly': False,  # App must appear in Dock so user doesn't relaunch
    },
)

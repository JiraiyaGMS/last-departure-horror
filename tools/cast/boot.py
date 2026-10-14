# Load MPFB as a Blender extension inside the bpy module and point it at the CC0 assets.
import bpy, addon_utils, os, sys, shutil, importlib

# The work folder holds mpfb2/ and assets/; this script sits in its gen/.
MH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(MH, 'mpfb2', 'src', 'mpfb')
ASSETS = os.path.join(MH, 'assets')

def boot():
    ext_root = bpy.utils.user_resource('EXTENSIONS', path='user_default', create=True)
    dst = os.path.join(ext_root, 'mpfb')
    if not os.path.exists(dst):
        shutil.copytree(SRC, dst)
    if ext_root not in sys.path:
        pass
    # Make sure the user_default repo is known and the module importable.
    try:
        bpy.ops.extensions.repo_refresh_all()
    except Exception as e:
        print('repo refresh failed', e)
    mod, ok = None, False
    try:
        addon_utils.enable('bl_ext.user_default.mpfb', default_set=True, handle_error=lambda e: print('enable error', e))
        ok = True
    except Exception as e:
        print('enable exception', e)
    pkg = 'bl_ext.user_default.mpfb'
    print('enabled:', pkg in bpy.context.preferences.addons)
    m = importlib.import_module(pkg)
    LocationService = importlib.import_module(pkg + '.services.locationservice').LocationService
    ud = LocationService.get_user_data()
    print('user data:', ud)
    for d in os.listdir(ASSETS):
        link = os.path.join(ud, d)
        if not os.path.exists(link):
            os.makedirs(ud, exist_ok=True)
            os.symlink(os.path.join(ASSETS, d), link)
    return pkg

def svc(pkg, mod, name):
    return getattr(importlib.import_module(f'{pkg}.services.{mod}'), name)

if __name__ == '__main__':
    pkg = boot()
    AssetService = svc(pkg, 'assetservice', 'AssetService')
    print('skin found:', AssetService.find_asset_absolute_path('old_caucasian_male.mhmat', asset_subdir='skins'))

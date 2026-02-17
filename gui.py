#!/usr/bin/env python3
"""
macOS application window for lens surface input and ray-optics results.
Uses PyObjC (AppKit). Five surfaces: radius (mm), thickness (mm), material (n or n,V).
"""

import sys
import os

# When run as a frozen .app (e.g. PyInstaller), ensure script directory is on path
# so lazy-import of singlet_rayoptics can find the module in the bundle.
if getattr(sys, "frozen", False):
    app_dir = os.path.dirname(sys.executable)
    if hasattr(sys, "_MEIPASS"):
        app_dir = sys._MEIPASS
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)

import objc
from AppKit import (
    NSApplication,
    NSWindow,
    NSTextField,
    NSButton,
    NSScrollView,
    NSTextView,
    NSMakeRect,
    NSWindowStyleMaskTitled,
    NSWindowStyleMaskClosable,
    NSWindowStyleMaskResizable,
    NSBackingStoreBuffered,
    NSFont,
    NSAlert,
)
from Foundation import NSObject, NSString, NSRunLoop, NSDate

# singlet_rayoptics is imported lazily when Calculate is clicked (avoids startup
# crashes from heavy deps when launching the .app from Finder).

_DEBUG_LOG = None

def _debug(msg):
    """Write debug message to file and stderr for troubleshooting."""
    print("[GUI]", msg, flush=True)
    global _DEBUG_LOG
    if _DEBUG_LOG is None:
        for p in ["/tmp/gui_debug.txt", os.path.expanduser("~/gui_debug.txt")]:
            try:
                with open(p, "a", encoding="utf-8") as f:
                    f.write("init\n")
                _DEBUG_LOG = p
                break
            except Exception:
                continue
    if _DEBUG_LOG:
        try:
            with open(_DEBUG_LOG, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
        except Exception:
            pass


def _set_results_text(view, text):
    """Update NSTextView content. Use setString_ (most reliable) and force display."""
    if view is None:
        return
    s = str(text) if text else ""
    ns_str = NSString.stringWithString_(s)
    view.setString_(ns_str)
    view.setNeedsDisplay_(True)
    view.displayIfNeeded()
    # Force the window to flush display updates
    w = view.window()
    if w is not None:
        w.displayIfNeeded()


def _show_result_alert(title, message):
    """Show an alert with the result so the user always sees output."""
    msg = str(message).strip() if message else "No output."
    if len(msg) > 800:
        msg = msg[:797] + "..."
    alert = NSAlert.alloc().init()
    alert.setMessageText_(NSString.stringWithString_(title))
    alert.setInformativeText_(NSString.stringWithString_(msg))
    alert.addButtonWithTitle_("OK")
    alert.runModal()


def parse_material(s):
    """Parse material string 'n' or 'n,V' -> (n, V). Default V=0."""
    s = (s or "").strip()
    if not s:
        return 1.0, 0.0
    parts = [p.strip() for p in s.replace(",", " ").split()]
    n = float(parts[0]) if parts else 1.0
    v = float(parts[1]) if len(parts) > 1 else 0.0
    return n, v


def parse_radius(s):
    """Parse radius (mm). 0 or empty -> curvature 0 (flat)."""
    s = (s or "").strip()
    if not s:
        return 0.0
    r = float(s)
    if r == 0:
        return 0.0
    return 1.0 / r


def parse_thickness(s):
    """Parse thickness (mm)."""
    s = (s or "").strip()
    return float(s) if s else 0.0


def parse_wavelength(s):
    """Parse wavelength (nm). Default 587.6 (d-line)."""
    s = (s or "").strip()
    if not s:
        return 587.6
    return float(s)


class OpticsAppDelegate(NSObject):
    def applicationDidFinishLaunching_(self, notification):
        self.window.makeKeyAndOrderFront_(None)


def main():
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(0)  # NSApplicationActivationPolicyRegular = windowed app
    delegate = OpticsAppDelegate.alloc().init()
    app.setDelegate_(delegate)

    # Window
    width, height = 560, 520
    window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
        ((100, 100), (width, height)),
        NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable,
        NSBackingStoreBuffered,
        False,
    )
    window.setTitle_("Lens Ray-Optics Calculator")
    window.setMinSize_((400, 400))
    content = window.contentView()

    # Layout constants
    margin = 20
    row_h = 24
    col1 = margin
    col2 = 120
    col3 = 220
    col4 = 320
    col5 = 420
    field_w = 90
    material_w = 95

    # Surface inputs (5 surfaces)
    inputs = []
    for i in range(5):
        y = height - margin - (i + 1) * row_h
        label = NSTextField.alloc().initWithFrame_(NSMakeRect(col1, y, 70, 20))
        label.setStringValue_("Surface {}:".format(i + 1))
        label.setEditable_(False)
        label.setBordered_(False)
        label.setDrawsBackground_(False)
        content.addSubview_(label)

        r_f = NSTextField.alloc().initWithFrame_(NSMakeRect(col2, y, field_w, 20))
        r_f.setPlaceholderString_("Radius (mm)")
        content.addSubview_(r_f)

        t_f = NSTextField.alloc().initWithFrame_(NSMakeRect(col3, y, field_w, 20))
        t_f.setPlaceholderString_("Thickness (mm)")
        content.addSubview_(t_f)

        m_f = NSTextField.alloc().initWithFrame_(NSMakeRect(col4, y, material_w, 20))
        m_f.setPlaceholderString_("n or n,V")
        content.addSubview_(m_f)

        inputs.append((r_f, t_f, m_f))

    # Wavelength input
    wvl_y = height - margin - 6 * row_h
    wvl_label = NSTextField.alloc().initWithFrame_(NSMakeRect(col1, wvl_y, 100, 20))
    wvl_label.setStringValue_("Wavelength:")
    wvl_label.setEditable_(False)
    wvl_label.setBordered_(False)
    wvl_label.setDrawsBackground_(False)
    content.addSubview_(wvl_label)

    wvl_field = NSTextField.alloc().initWithFrame_(NSMakeRect(col2, wvl_y, field_w, 20))
    wvl_field.setPlaceholderString_("nm (e.g. 587.6)")
    wvl_field.setStringValue_("587.6")
    content.addSubview_(wvl_field)

    # Calculate button
    btn_y = height - margin - 7 * row_h - 8
    button = NSButton.alloc().initWithFrame_(NSMakeRect(col1, btn_y, 120, 28))
    button.setTitle_("Calculate")
    button.setBezelStyle_(4)  # NSRoundedBezelStyle

    # Results text area (scrollable)
    results_y = margin + 40
    results_h = btn_y - margin - 40
    scroll = NSScrollView.alloc().initWithFrame_(NSMakeRect(margin, margin, width - 2 * margin, results_h))
    scroll.setHasVerticalScroller_(True)
    scroll.setHasHorizontalScroller_(False)
    scroll.setAutohidesScrollers_(True)
    scroll.setBorderType_(1)  # NSBezelBorder

    # Use scroll's frame size so document view has valid size (contentSize() can be 0 before layout)
    results_text = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, width - 2 * margin, max(results_h, 200)))
    results_text.setEditable_(False)
    results_text.setSelectable_(True)
    results_text.setFont_(NSFont.userFixedPitchFontOfSize_(12))
    results_text.setString_(NSString.stringWithString_(
        "Enter surface data and click Calculate.\n\nRadius: mm (use 0 for flat).\nThickness: mm.\nMaterial: n or n,V (e.g. 1.5168,64.2 or 1 for air)."
    ))
    scroll.setDocumentView_(results_text)
    content.addSubview_(scroll)

    content.addSubview_(button)

    def on_calculate_clicked(sender):
        """Calculate button action: read inputs -> call rayoptics -> update result area."""
        try:
            _on_calculate_impl(sender)
        except Exception as e:
            _debug("TOP-LEVEL ERROR: " + str(e))
            import traceback
            tb = traceback.format_exc()
            _debug(tb)
            _set_results_text(results_text, "Error: " + str(e))
            _show_result_alert("Error", str(e))
            window.makeKeyAndOrderFront_(None)

    def _on_calculate_impl(sender):
        """Inner implementation of Calculate action."""
        # Clear debug log and show immediate feedback
        try:
            for path in ["/tmp/gui_debug.txt", os.path.expanduser("~/gui_debug.txt")]:
                try:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write("Calculate clicked\n")
                    break
                except Exception:
                    continue
        except Exception:
            pass
        _debug("Starting calculation flow")
        _set_results_text(results_text, "Calculating...")
        # Yield to run loop so "Calculating..." is drawn before we block on import
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.05))

        # 1. Read inputs from the text fields (skip fully empty rows)
        _debug("Reading inputs")
        surf_data_list = []
        for r_f, t_f, m_f in inputs:
            radius_str = (r_f.stringValue() or "").strip()
            thickness_str = (t_f.stringValue() or "").strip()
            material_str = (m_f.stringValue() or "").strip()
            if not radius_str and not thickness_str and not material_str:
                continue
            try:
                curvature = parse_radius(radius_str if radius_str else "0")
                thickness = parse_thickness(thickness_str if thickness_str else "0")
                n, v = parse_material(material_str if material_str else "1")
                surf_data_list.append([curvature, thickness, n, v])
            except Exception as e:
                msg = "Invalid input: {}.\n\nCheck radius, thickness, and material (n or n,V).".format(e)
                _set_results_text(results_text, msg)
                _debug("Invalid input: " + str(e))
                return
        if not surf_data_list:
            _set_results_text(results_text, "Enter at least one surface.")
            _debug("No surfaces")
            return
        # If only one surface given, add symmetric back surface (singlet lens)
        if len(surf_data_list) == 1:
            c, t, n, v = surf_data_list[0]
            surf_data_list.append([-c if c != 0 else 0.0, 100.0, 1.0, 0.0])

        # Parse wavelength (nm)
        try:
            wvl_nm = parse_wavelength(wvl_field.stringValue())
            if wvl_nm <= 0 or wvl_nm > 2000:
                raise ValueError("Wavelength must be between 1 and 2000 nm")
        except Exception as e:
            msg = "Invalid wavelength: {}.\n\nEnter wavelength in nm (e.g. 587.6 for d-line).".format(e)
            _set_results_text(results_text, msg)
            _debug("Invalid wavelength: " + str(e))
            return

        # 2. Pass that data to the rayoptics function (lazy import for .app launch)
        _debug("About to import singlet_rayoptics")
        try:
            # Fix rayoptics.__version__ before import: PyInstaller bundles lose
            # package metadata, so __version__ becomes 'unknown' and breaks
            # packaging.version.parse() in deprecation decorators.
            import rayoptics
            if getattr(rayoptics, "__version__", "") == "unknown":
                rayoptics.__version__ = "0.8.7"

            # NumPy 2.0 removed np.NaN; rayoptics uses it. Restore alias.
            import numpy as _np
            if not hasattr(_np, "NaN"):
                _np.NaN = _np.nan

            # Break circular import: rayoptics.optical.opticalmodel -> elements ->
            # appcmds -> obench -> opticalmodel. Stub appcmds so elements gets
            # a minimal module (open_model only used by create_from_file, which
            # we don't use). Must run before any import of opticalmodel.
            import sys
            import types
            if "rayoptics.gui.appcmds" not in sys.modules:
                _debug("Installing appcmds stub to break circular import")
                gui_mod = sys.modules.get("rayoptics.gui")
                if gui_mod is None:
                    gui_mod = types.ModuleType("rayoptics.gui")
                    # Must be a package so rayoptics.gui.actions can load
                    _ro = __import__("rayoptics", fromlist=[])
                    _gui_dir = os.path.join(os.path.dirname(_ro.__file__), "gui")
                    gui_mod.__path__ = [_gui_dir]
                    sys.modules["rayoptics.gui"] = gui_mod
                stub = types.ModuleType("rayoptics.gui.appcmds")

                def _open_model_stub(*args, **kwargs):
                    raise NotImplementedError(
                        "open_model not available in headless mode"
                    )

                stub.open_model = _open_model_stub
                sys.modules["rayoptics.gui.appcmds"] = stub

            from singlet_rayoptics import calculate_and_format_results
            _debug("Import OK")
        except ImportError as e:
            _debug("Import failed: " + str(e))
            msg = "Could not load ray-optics module.\n\nImport error: {}".format(e)
            _set_results_text(results_text, msg)
            _show_result_alert("Import Error", msg)
            window.makeKeyAndOrderFront_(None)
            return
        _debug("About to run calculation")
        try:
            output = calculate_and_format_results(surf_data_list, wvl_nm=wvl_nm)
            _debug("Calculation done, len=" + str(len(str(output))))
        except Exception as e:
            _debug("Calculation exception: " + str(e))
            output = "Calculation error: {}".format(e)

        # 3. Update the result text area with the output
        if not (output and str(output).strip()):
            output = "No output from calculation."
        _debug("About to set results text")
        _set_results_text(results_text, output)
        results_text.scrollRangeToVisible_((0, 1))
        # Fallback: write to Desktop so user can open file if GUI doesn't show
        try:
            desktop = os.path.join(os.path.expanduser("~"), "Desktop", "lens_results.txt")
            with open(desktop, "w", encoding="utf-8") as f:
                f.write(output)
            _debug("Wrote to " + desktop)
        except Exception as e:
            _debug("Could not write to Desktop: " + str(e))
        _debug("About to show alert")
        _show_result_alert("Results", output)
        _debug("Alert dismissed")
        window.makeKeyAndOrderFront_(None)

    class ButtonTarget(NSObject):
        def calculate_(self, sender):
            on_calculate_clicked(sender)

    target = ButtonTarget.alloc().init()
    button.setTarget_(target)
    button.setAction_("calculate:")

    delegate.window = window
    delegate.button_target = target  # keep reference so action works
    app.activateIgnoringOtherApps_(True)
    app.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        alert = NSAlert.alloc().init()
        alert.setMessageText_("Application Error")
        alert.setInformativeText_(str(e))
        alert.runModal()
        raise

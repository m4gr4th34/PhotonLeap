#!/usr/bin/env python3
"""
macOS application window for lens surface input and ray-optics results.
Uses PyObjC (AppKit). Surfaces: radius (mm), thickness (mm), material (n or n,V).
Starts with 10 surfaces; right-click any surface to add more (no limit).
"""

import sys
import os
import json
import threading

# Ensure script directory is on path so lazy-import finds singlet_rayoptics and optics_visualization.
if getattr(sys, "frozen", False):
    app_dir = os.path.dirname(sys.executable)
    if hasattr(sys, "_MEIPASS"):
        app_dir = sys._MEIPASS
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
else:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

import objc
from AppKit import (
    NSApplication,
    NSWindow,
    NSView,
    NSTextField,
    NSButton,
    NSScrollView,
    NSTextView,
    NSMenu,
    NSMenuItem,
    NSMakeRect,
    NSWindowStyleMaskTitled,
    NSWindowStyleMaskClosable,
    NSWindowStyleMaskResizable,
    NSBackingStoreBuffered,
    NSFont,
    NSAlert,
    NSViewWidthSizable,
    NSViewHeightSizable,
    NSViewMinYMargin,
    NSViewMaxYMargin,
    NSSavePanel,
    NSOpenPanel,
    NSModalResponseOK,
)
from Foundation import NSObject, NSString, NSRunLoop, NSDate
from WebKit import WKWebView, WKWebViewConfiguration

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


from parsing import (
    parse_material,
    parse_radius,
    parse_thickness,
    parse_wavelength,
    parse_diameter,
)


def _get_field_values(r_f, t_f, m_f, d_f, desc_f):
    """Return tuple of string values from surface fields."""
    return (
        (r_f.stringValue() or "").strip(),
        (t_f.stringValue() or "").strip(),
        (m_f.stringValue() or "").strip(),
        (d_f.stringValue() or "").strip(),
        (desc_f.stringValue() or "").strip(),
    )


def _set_field_values(r_f, t_f, m_f, d_f, desc_f, vals):
    """Set surface field values from tuple (radius, thickness, material, diameter, description)."""
    r_f.setStringValue_(vals[0])
    t_f.setStringValue_(vals[1])
    m_f.setStringValue_(vals[2])
    d_f.setStringValue_(vals[3])
    desc_f.setStringValue_(vals[4])


class SurfaceTableController:
    """Manages the surface table: adds rows dynamically, no maximum limit."""

    def __init__(self, surfaces_doc, row_views, row_handlers, inputs,
                 doc_width, row_h, col1, col2, col3, col4, col5, col6,
                 field_w, material_w, diam_w, desc_w, handler_class):
        self.surfaces_doc = surfaces_doc
        self.row_views = row_views
        self.row_handlers = row_handlers
        self.inputs = inputs
        self.doc_width = doc_width
        self.row_h = row_h
        self.col1, self.col2, self.col3 = col1, col2, col3
        self.col4, self.col5, self.col6 = col4, col5, col6
        self.field_w = field_w
        self.material_w = material_w
        self.diam_w = diam_w
        self.desc_w = desc_w
        self.HandlerClass = handler_class

    def _create_row(self, index):
        """Create a new row view, fields, and handler; return (row_view, inputs_tuple, row_handler)."""
        row_view = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, self.doc_width, self.row_h))
        row_view.setAutoresizingMask_(NSViewWidthSizable)

        label = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col1, 2, 110, 20))
        label.setStringValue_("Surface {}:".format(index + 1))
        label.setEditable_(False)
        label.setBordered_(False)
        label.setDrawsBackground_(False)
        row_view.addSubview_(label)

        r_f = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col2, 2, self.field_w, 20))
        r_f.setPlaceholderString_("Radius (mm)")
        row_view.addSubview_(r_f)

        t_f = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col3, 2, self.field_w, 20))
        t_f.setPlaceholderString_("Thickness (mm)")
        row_view.addSubview_(t_f)

        m_f = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col4, 2, self.material_w, 20))
        m_f.setPlaceholderString_("n or n,V")
        row_view.addSubview_(m_f)

        d_f = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col5, 2, self.diam_w, 20))
        d_f.setPlaceholderString_("Diam (mm)")
        row_view.addSubview_(d_f)

        desc_f = NSTextField.alloc().initWithFrame_(NSMakeRect(self.col6, 2, self.desc_w, 20))
        desc_f.setPlaceholderString_("Description")
        row_view.addSubview_(desc_f)

        row_handler = self.HandlerClass.alloc().init()
        row_handler.setController_(self)
        row_handler.setRowIndex_(index)

        ctx_menu = NSMenu.alloc().initWithTitle_("Surface")
        before_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Add surface before", "addSurfaceBefore:", ""
        )
        before_item.setTarget_(row_handler)
        after_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Add surface after", "addSurfaceAfter:", ""
        )
        after_item.setTarget_(row_handler)
        delete_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Delete surface", "deleteSurface:", ""
        )
        delete_item.setTarget_(row_handler)
        ctx_menu.addItem_(before_item)
        ctx_menu.addItem_(after_item)
        ctx_menu.addItem_(delete_item)
        row_view.setMenu_(ctx_menu)
        for sub in row_view.subviews():
            sub.setMenu_(ctx_menu)

        return row_view, (r_f, t_f, m_f, d_f, desc_f), row_handler

    def _relayout(self):
        """Update document size and all row positions."""
        n = len(self.inputs)
        doc_h = n * self.row_h
        self.surfaces_doc.setFrame_(NSMakeRect(0, 0, self.doc_width, doc_h))
        for i, row_view in enumerate(self.row_views):
            y = doc_h - (i + 1) * self.row_h
            row_view.setFrame_(NSMakeRect(0, y, self.doc_width, self.row_h))
        for i, h in enumerate(self.row_handlers):
            h.setRowIndex_(i)
        for i, row_view in enumerate(self.row_views):
            label = row_view.subviews()[0]
            label.setStringValue_("Surface {}:".format(i + 1))

    def add_row_before(self, idx):
        self._insert_row(idx)

    def add_row_after(self, idx):
        self._insert_row(idx + 1)

    def delete_row(self, idx):
        """Remove the row at index idx."""
        if idx < 0 or idx >= len(self.inputs):
            return
        row_view = self.row_views[idx]
        row_view.removeFromSuperview()
        del self.inputs[idx]
        del self.row_views[idx]
        del self.row_handlers[idx]
        self._relayout()

    def _insert_row(self, idx):
        row_view, inputs_tuple, row_handler = self._create_row(idx)
        self.inputs.insert(idx, inputs_tuple)
        self.row_views.insert(idx, row_view)
        self.row_handlers.insert(idx, row_handler)
        self.surfaces_doc.addSubview_(row_view)
        self._relayout()


class SurfaceMenuHandler(NSObject):
    """Handles context menu actions for adding surfaces before/after a row."""

    def init(self):
        self = objc.super(SurfaceMenuHandler, self).init()
        if self is None:
            return None
        self.controller = None
        self.row_index = 0
        return self

    def setController_(self, ctrl):
        self.controller = ctrl

    def setRowIndex_(self, idx):
        self.row_index = idx

    def addSurfaceBefore_(self, sender):
        if self.controller:
            self.controller.add_row_before(self.row_index)

    def addSurfaceAfter_(self, sender):
        if self.controller:
            self.controller.add_row_after(self.row_index)

    def deleteSurface_(self, sender):
        if self.controller:
            self.controller.delete_row(self.row_index)


class OpticsAppDelegate(NSObject):
    def applicationDidFinishLaunching_(self, notification):
        self.window.makeKeyAndOrderFront_(None)

    def applicationShouldHandleReopen_hasVisibleWindows_(self, sender, flag):
        """Bring our window to front when user clicks Dock icon; prevents launching a new instance."""
        if self.window:
            self.window.makeKeyAndOrderFront_(None)
        return True


def main():
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(0)  # NSApplicationActivationPolicyRegular = windowed app
    delegate = OpticsAppDelegate.alloc().init()
    app.setDelegate_(delegate)

    # Window
    width, height = 800, 620
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
    num_surfaces = 10
    surfaces_scroll_h = 180
    col1 = margin
    col2 = 140
    col3 = 245
    col4 = 345
    col5 = 435
    col6 = 495
    field_w = 85
    material_w = 90
    diam_w = 55
    desc_w = 180

    # Surface inputs - scroll view with 10 rows, right-click to add before/after
    top_pin = NSViewMinYMargin
    surfaces_doc_h = num_surfaces * row_h
    surfaces_scroll = NSScrollView.alloc().initWithFrame_(
        NSMakeRect(margin, height - margin - surfaces_scroll_h, width - 2 * margin, surfaces_scroll_h)
    )
    surfaces_scroll.setHasVerticalScroller_(True)
    surfaces_scroll.setHasHorizontalScroller_(False)
    surfaces_scroll.setAutohidesScrollers_(True)
    surfaces_scroll.setBorderType_(1)
    surfaces_scroll.setAutoresizingMask_(NSViewWidthSizable | top_pin)
    surfaces_doc = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, width - 2 * margin - 20, surfaces_doc_h))
    surfaces_scroll.setDocumentView_(surfaces_doc)
    content.addSubview_(surfaces_scroll)

    doc_width = width - 2 * margin - 20
    inputs = []
    row_views = []
    row_handlers = []
    table_ctrl = SurfaceTableController(
        surfaces_doc, row_views, row_handlers, inputs,
        doc_width, row_h, col1, col2, col3, col4, col5, col6,
        field_w, material_w, diam_w, desc_w, SurfaceMenuHandler
    )
    for i in range(num_surfaces):
        row_view, inputs_tuple, row_handler = table_ctrl._create_row(i)
        inputs.append(inputs_tuple)
        row_views.append(row_view)
        row_handlers.append(row_handler)
        surfaces_doc.addSubview_(row_view)
    table_ctrl._relayout()

    # Wavelength input - pinned to top
    wvl_y = height - margin - surfaces_scroll_h - row_h
    wvl_label = NSTextField.alloc().initWithFrame_(NSMakeRect(col1, wvl_y, 100, 20))
    wvl_label.setStringValue_("Wavelength:")
    wvl_label.setEditable_(False)
    wvl_label.setBordered_(False)
    wvl_label.setDrawsBackground_(False)
    wvl_label.setAutoresizingMask_(top_pin)
    content.addSubview_(wvl_label)

    wvl_field = NSTextField.alloc().initWithFrame_(NSMakeRect(col2, wvl_y, field_w, 20))
    wvl_field.setPlaceholderString_("nm (e.g. 587.6)")
    wvl_field.setStringValue_("587.6")
    wvl_field.setAutoresizingMask_(top_pin)
    content.addSubview_(wvl_field)

    # Calculate, Save, Load buttons - pinned to top
    btn_y = height - margin - surfaces_scroll_h - 2 * row_h - 8
    button = NSButton.alloc().initWithFrame_(NSMakeRect(col1, btn_y, 100, 28))
    button.setTitle_("Calculate")
    button.setBezelStyle_(4)  # NSRoundedBezelStyle
    button.setAutoresizingMask_(top_pin)

    save_btn = NSButton.alloc().initWithFrame_(NSMakeRect(col2, btn_y, 70, 28))
    save_btn.setTitle_("Save")
    save_btn.setBezelStyle_(4)
    save_btn.setAutoresizingMask_(top_pin)

    load_btn = NSButton.alloc().initWithFrame_(NSMakeRect(col2 + 75, btn_y, 70, 28))
    load_btn.setTitle_("Load")
    load_btn.setBezelStyle_(4)
    load_btn.setAutoresizingMask_(top_pin)

    # Results text area (scrollable) - fixed height, between button and visualization
    results_h = 120
    results_y = btn_y - 10 - results_h
    scroll = NSScrollView.alloc().initWithFrame_(NSMakeRect(margin, results_y, width - 2 * margin, results_h))
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
        "Enter surface data and click Calculate.\n\n"
        "Radius: mm (use 0 for flat). Thickness: mm.\n"
        "Material: n or n,V (e.g. 1.5168,64.2 or 1 for air).\n"
        "Diam: mm (optional, surface diameter for ray trace and display).\n"
        "Description: optional label for the surface (e.g. 'front lens', 'stop').\n\n"
        "Right-click any surface row to add or delete surfaces.\n\n"
        "Use Save to save surfaces to a .json file; Load to restore from file.\n"
        "The optical layout and ray trace will appear below."
    ))
    scroll.setDocumentView_(results_text)
    scroll.setAutoresizingMask_(NSViewWidthSizable | NSViewMinYMargin)
    content.addSubview_(scroll)

    # Visualization (Plotly in embedded WebView) - top fixed below results, grows down with window
    viz_h = results_y - margin - 20
    viz_y = margin
    viz_frame = NSMakeRect(margin, viz_y, width - 2 * margin, viz_h)
    web_config = WKWebViewConfiguration.alloc().init()
    web_view = WKWebView.alloc().initWithFrame_configuration_(viz_frame, web_config)
    web_view.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable | NSViewMinYMargin)
    content.addSubview_(web_view)

    content.addSubview_(button)
    content.addSubview_(save_btn)
    content.addSubview_(load_btn)

    def _surfaces_to_dict():
        """Export current surface inputs and wavelength to a dict for JSON."""
        surfaces = []
        for r_f, t_f, m_f, d_f, desc_f in inputs:
            surfaces.append({
                "radius": (r_f.stringValue() or "").strip(),
                "thickness": (t_f.stringValue() or "").strip(),
                "material": (m_f.stringValue() or "").strip(),
                "diameter": (d_f.stringValue() or "").strip(),
                "description": (desc_f.stringValue() or "").strip(),
            })
        return {"wavelength": (wvl_field.stringValue() or "").strip(), "surfaces": surfaces}

    def _dict_to_surfaces(data):
        """Load surface inputs and wavelength from a dict."""
        wvl = data.get("wavelength", "")
        wvl_field.setStringValue_(wvl if wvl else "587.6")
        surfaces = data.get("surfaces", [])
        while len(inputs) < len(surfaces):
            if len(inputs) == 0:
                table_ctrl.add_row_before(0)
            else:
                table_ctrl.add_row_after(len(inputs) - 1)
        for i, (r_f, t_f, m_f, d_f, desc_f) in enumerate(inputs):
            if i < len(surfaces):
                s = surfaces[i]
                r_f.setStringValue_(s.get("radius", ""))
                t_f.setStringValue_(s.get("thickness", ""))
                m_f.setStringValue_(s.get("material", ""))
                d_f.setStringValue_(s.get("diameter", ""))
                desc_f.setStringValue_(s.get("description", ""))
            else:
                r_f.setStringValue_("")
                t_f.setStringValue_("")
                m_f.setStringValue_("")
                d_f.setStringValue_("")
                desc_f.setStringValue_("")

    def on_save_clicked(sender):
        panel = NSSavePanel.savePanel()
        panel.setTitle_("Save Surfaces")
        panel.setAllowedFileTypes_(["json", "opt"])
        panel.setAllowsOtherFileTypes_(True)
        panel.setCanCreateDirectories_(True)
        if panel.runModal() == NSModalResponseOK:
            path = panel.URL().path()
            if path:
                try:
                    data = _surfaces_to_dict()
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                    _set_results_text(results_text, "Saved to " + path)
                except Exception as e:
                    _show_result_alert("Save Error", str(e))

    def on_load_clicked(sender):
        panel = NSOpenPanel.openPanel()
        panel.setTitle_("Load Surfaces")
        panel.setAllowedFileTypes_(["json", "opt"])
        panel.setAllowsMultipleSelection_(False)
        panel.setCanChooseDirectories_(False)
        if panel.runModal() == NSModalResponseOK:
            url = panel.URL()
            if url is not None:
                path = url.path()
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    _dict_to_surfaces(data)
                    _set_results_text(results_text, "Loaded from " + path)
                except Exception as e:
                    _show_result_alert("Load Error", str(e))

    def on_calculate_clicked(sender):
        """Calculate button action: run calculation on background thread to keep main thread responsive."""
        def run_in_background():
            try:
                result = _on_calculate_impl(
                    inputs, wvl_field, table_ctrl, parse_radius, parse_thickness,
                    parse_material, parse_wavelength, parse_diameter
                )
                # Update UI on main thread (required for AppKit)
                target.performSelectorOnMainThread_withObject_waitUntilDone_(
                    "finishCalculation:", result, False
                )
            except Exception as e:
                _debug("TOP-LEVEL ERROR: " + str(e))
                import traceback
                tb = traceback.format_exc()
                _debug(tb)
                err_result = {"output": "Error: " + str(e), "viz_html": None, "error": True}
                target.performSelectorOnMainThread_withObject_waitUntilDone_(
                    "finishCalculation:", err_result, False
                )

        # Disable button during calculation
        button.setEnabled_(False)
        _set_results_text(results_text, "Calculating...")
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.05))
        threading.Thread(target=run_in_background, daemon=True).start()

    def _on_calculate_impl(inputs_ref, wvl_field_ref, table_ctrl_ref, parse_radius_fn, parse_thickness_fn,
                           parse_material_fn, parse_wavelength_fn, parse_diameter_fn):
        """Inner implementation of Calculate action. Runs on background thread. Returns dict with output and viz_html."""
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

        # 1. Read inputs from the text fields (skip fully empty rows)
        _debug("Reading inputs")
        surf_data_list = []
        surface_diameters = []
        for r_f, t_f, m_f, d_f, desc_f in inputs_ref:
            radius_str = (r_f.stringValue() or "").strip()
            thickness_str = (t_f.stringValue() or "").strip()
            material_str = (m_f.stringValue() or "").strip()
            diameter_str = (d_f.stringValue() or "").strip()
            if not radius_str and not thickness_str and not material_str:
                continue
            try:
                curvature = parse_radius_fn(radius_str if radius_str else "0")
                thickness = parse_thickness_fn(thickness_str if thickness_str else "0")
                n, v = parse_material_fn(material_str if material_str else "1")
                surf_data_list.append([curvature, thickness, n, v])
                surface_diameters.append(parse_diameter_fn(diameter_str))
            except Exception as e:
                msg = "Invalid input: {}.\n\nCheck radius, thickness, material (n or n,V), and diameter.".format(e)
                _debug("Invalid input: " + str(e))
                return {"output": msg, "viz_html": None, "error": True}
        if not surf_data_list:
            _debug("No surfaces")
            return {"output": "Enter at least one surface.", "viz_html": None, "error": True}
        # If only one surface given, add symmetric back surface (singlet lens)
        if len(surf_data_list) == 1:
            c, t, n, v = surf_data_list[0]
            surf_data_list.append([-c if c != 0 else 0.0, 100.0, 1.0, 0.0])
            surface_diameters.append(surface_diameters[0] if surface_diameters else None)

        # Parse wavelength (nm)
        try:
            wvl_nm = parse_wavelength_fn(wvl_field_ref.stringValue())
            if wvl_nm <= 0 or wvl_nm > 2000:
                raise ValueError("Wavelength must be between 1 and 2000 nm")
        except Exception as e:
            msg = "Invalid wavelength: {}.\n\nEnter wavelength in nm (e.g. 587.6 for d-line).".format(e)
            _debug("Invalid wavelength: " + str(e))
            return {"output": msg, "viz_html": None, "error": True}

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
            return {"output": msg, "viz_html": None, "error": True}
        _debug("About to run calculation")
        opt_model = None
        try:
            output, opt_model = calculate_and_format_results(
                surf_data_list, wvl_nm=wvl_nm, return_opt_model=True,
                surface_diameters=surface_diameters
            )
            _debug("Calculation done, len=" + str(len(str(output))))
        except Exception as e:
            _debug("Calculation exception: " + str(e))
            output = "Calculation error: {}".format(e)

        viz_html = None
        if opt_model is not None:
            try:
                from optics_visualization import render_optical_layout
                viz_html = render_optical_layout(
                    opt_model, wvl_nm=wvl_nm, num_rays=11,
                    figsize=(8, 4), dpi=100, return_html=True
                )
                _debug("Visualization HTML generated")
            except Exception as viz_err:
                _debug("Visualization failed: " + str(viz_err))

        if not (output and str(output).strip()):
            output = "No output from calculation."
        _debug("About to set results text")
        return {"output": output, "viz_html": viz_html, "error": False}

    class ButtonTarget(NSObject):
        def init(self):
            self = objc.super(ButtonTarget, self).init()
            if self is None:
                return None
            self._button = None
            self._results_text = None
            self._web_view = None
            self._window = None
            return self

        def setButton_resultsText_webView_window_(self, btn, results, wv, win):
            self._button = btn
            self._results_text = results
            self._web_view = wv
            self._window = win

        def calculate_(self, sender):
            on_calculate_clicked(sender)

        def save_(self, sender):
            on_save_clicked(sender)

        def load_(self, sender):
            on_load_clicked(sender)

        def finishCalculation_(self, result):
            """Called on main thread to update UI with calculation results."""
            if self._button:
                self._button.setEnabled_(True)
            if result.get("error"):
                _set_results_text(self._results_text, result["output"])
                _show_result_alert("Error", result["output"])
            else:
                _set_results_text(self._results_text, result["output"])
                if self._results_text:
                    self._results_text.scrollRangeToVisible_((0, 1))
                viz_html = result.get("viz_html")
                if viz_html and self._web_view:
                    try:
                        self._web_view.loadHTMLString_baseURL_(
                            NSString.stringWithString_(viz_html), None
                        )
                        self._web_view.setNeedsDisplay_(True)
                        self._web_view.displayIfNeeded()
                    except Exception as e:
                        _debug("Failed to load viz HTML: " + str(e))
                try:
                    desktop = os.path.join(os.path.expanduser("~"), "Desktop", "lens_results.txt")
                    with open(desktop, "w", encoding="utf-8") as f:
                        f.write(result["output"])
                except Exception:
                    pass
            if self._window:
                self._window.makeKeyAndOrderFront_(None)

    target = ButtonTarget.alloc().init()
    target.setButton_resultsText_webView_window_(button, results_text, web_view, window)
    button.setTarget_(target)
    button.setAction_("calculate:")
    save_btn.setTarget_(target)
    save_btn.setAction_("save:")
    load_btn.setTarget_(target)
    load_btn.setAction_("load:")

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

"""
In-browser paraxial ray trace for MacOptics.
Runs in Pyodide (WebAssembly). Produces rays, surfaces, focusZ, performance.
Simplified implementation: spherical surfaces, Snell refraction, no rayoptics.

DATA STRUCTURE (Frontend <-> Backend). MUST match System Editor exactly.
  Surface[i] position: z_i = sum(thickness[0..i-1]). Surface 0 at z=0.
  Surface[i] refraction: n_in = material ray traveled through; n_out = material of surface i's row.
  optical_stack[i].n applies ONLY to propagation over optical_stack[i].thickness.
  If thickness=95mm and material='Air', n MUST be 1.0 for that entire distance.

INDEX MAPPING (UI 1-based <-> Python 0-based). MUST stay in sync with OpticalViewport.
  UI Surface 1 = Python index 0 = Front of Lens 1 (z=0)
  UI Surface 2 = Python index 1 = Back of Lens 1
  UI Surface 3 = Python index 2 = Front of Lens 2
  UI Surface 4 = Python index 3 = Back of Lens 2
"""

import numpy as np

# Epsilon to advance ray past surface after refraction; prevents re-intersection.
# 0.001 mm ensures next intersection search starts at z+0.001, not the same surface.
NUDGE_EPS = 0.001
# Minimum t for sphere intersection: strictly > T_MIN to pick exit hit when inside lens.
# Use 1e-4 to avoid re-hitting surface after nudge; ensures correct exit root for 7° rays.
T_MIN = 1e-4

# Ray start z: negative to give 'runway' before first surface at z=0.
RAY_START_Z = -10.0

# Target z for final air propagation (extend rays past last surface to focus region).
# Keep modest to avoid drawing rays far beyond the focal plane (backend extends only to focus).
Z_TARGET = 150.0

# Safety: max surfaces per ray to prevent infinite loops.
MAX_SURFACES = 100

# Termination reasons for sanity-check logging.
TERM_TIR = "TIR"
TERM_MISSED = "MISSED_SURFACE"
TERM_APERTURE = "APERTURE"
TERM_NUMERICAL = "NUMERICAL"

# Collect termination events for debugging (first N per run).
_termination_log = []
# Refraction diagnostics: n1, n2 at each surface (first ray only) for audit.
_refraction_log = []


def n_from_sellmeier(wvl_nm, sellmeier):
    """Refractive index from Sellmeier: n² = 1 + Σ Bᵢλ²/(λ²-Cᵢ). λ in µm."""
    wvl_um = wvl_nm / 1000.0
    B = sellmeier.get("B", [0, 0, 0])
    C = sellmeier.get("C", [0, 0, 0])
    if len(B) < 3 or len(C) < 3:
        return 1.52
    n2 = 1.0
    for i in range(3):
        n2 += B[i] * wvl_um**2 / (wvl_um**2 - C[i])
    return float(np.sqrt(max(1.0, n2)))


# Embedded glass library for wavelength-dependent n(λ) when sellmeierCoefficients missing.
# Matches backend glass_materials; enables chromatic dispersion in Pyodide mode.
_GLASS_LIBRARY = {
    "air": {"formula": "constant", "coeffs": {"n": 1.0}},
    "n-bk7": {"formula": "sellmeier", "coeffs": {"B": [1.03961212, 0.231792344, 1.01046945], "C": [0.00600069867, 0.0200179144, 103.560653]}},
    "bk7": "n-bk7", "nbk7": "n-bk7",
    "n-sf11": {"formula": "sellmeier", "coeffs": {"B": [1.73848403, 0.31116824, 1.17490871], "C": [0.0133711172, 0.0619001176, 121.419942]}},
    "n-sf5": {"formula": "sellmeier", "coeffs": {"B": [1.31038764, 0.196681836, 0.966129764], "C": [0.00958633072, 0.0457627625, 99.2753302]}},
    "n-sf6": {"formula": "sellmeier", "coeffs": {"B": [1.77931763, 0.33814987, 1.64430452], "C": [0.0133711172, 0.0619001176, 166.886499]}},
    "n-sf10": {"formula": "sellmeier", "coeffs": {"B": [1.61625974, 0.259229334, 0.96887106], "C": [0.0106200162, 0.0473625942, 119.248795]}},
    "n-sf14": {"formula": "sellmeier", "coeffs": {"B": [1.69022361, 0.288683042, 1.7045187], "C": [0.01306176267, 0.0619001176, 147.468793]}},
    "n-f2": {"formula": "sellmeier", "coeffs": {"B": [1.31038764, 0.196681836, 0.966129764], "C": [0.00958633072, 0.0457627625, 99.2753302]}},
    "f2": "n-f2",
    "n-sk2": {"formula": "sellmeier", "coeffs": {"B": [1.34317774, 0.241144399, 0.994317969], "C": [0.00704687339, 0.0229005, 92.7508526]}},
    "fused silica": {"formula": "sellmeier", "coeffs": {"B": [0.6961663, 0.4079426, 0.8974794], "C": [0.004679148, 0.01351206, 97.93432]}},
    "silica": "fused silica", "fused-silica": "fused silica",
    "n-baf10": {"formula": "sellmeier", "coeffs": {"B": [1.5851495, 0.143571385, 1.08521269], "C": [0.00909730952, 0.0424520636, 105.613573]}},
    "n-lak9": {"formula": "sellmeier", "coeffs": {"B": [1.41673927, 0.126605356, 1.28217827], "C": [0.00906333117, 0.0493226978, 95.6403971]}},
    "h-laf7": {"formula": "sellmeier", "coeffs": {"B": [1.66842615, 0.298521883, 1.07794363], "C": [0.00704687339, 0.0315631177, 95.2779353]}},
    "calcium fluoride": {"formula": "sellmeier", "coeffs": {"B": [0.5675888, 0.4710914, 3.8484723], "C": [0.00252643, 0.01007833, 1200.556]}},
    "caf2": "calcium fluoride",
    "magnesium fluoride": {"formula": "sellmeier", "coeffs": {"B": [0.48755108, 0.39875031, 2.3120353], "C": [0.001882178, 0.008951888, 566.13559]}},
    "mgf2": "magnesium fluoride",
    "sapphire": {"formula": "sellmeier", "coeffs": {"B": [1.4313493, 0.65054713, 5.3414021], "C": [0.0052799261, 0.0142382647, 325.017834]}},
    "n-k5": {"formula": "sellmeier", "coeffs": {"B": [1.15131343, 0.218304662, 0.839477603], "C": [0.00704687339, 0.0229005, 95.2593215]}},
    "n-sk16": {"formula": "sellmeier", "coeffs": {"B": [1.34317774, 0.241144399, 0.994317969], "C": [0.00704687339, 0.0229005, 92.7508526]}},
    "n-baf4": {"formula": "sellmeier", "coeffs": {"B": [1.31038764, 0.196681836, 0.966129764], "C": [0.00958633072, 0.0457627625, 99.2753302]}},
    "n-sf6ht": {"formula": "sellmeier", "coeffs": {"B": [1.77931763, 0.33814987, 1.64430452], "C": [0.0133711172, 0.0619001176, 166.886499]}},
    "n-lak14": {"formula": "sellmeier", "coeffs": {"B": [1.49172984, 0.127950879, 1.14545231], "C": [0.00779980626, 0.0315631177, 95.2779353]}},
    "n-bk10": {"formula": "sellmeier", "coeffs": {"B": [1.04502733, 0.231755984, 0.96817704], "C": [0.00600069867, 0.0200179144, 103.560653]}},
    "n-sf57": {"formula": "sellmeier", "coeffs": {"B": [1.81651371, 0.428893641, 1.07186278], "C": [0.0143704198, 0.0592801172, 121.419942]}},
    "n-sf66": {"formula": "sellmeier", "coeffs": {"B": [1.85504134, 0.420402765, 1.31047689], "C": [0.0162382647, 0.0619001176, 121.419942]}},
    "n-sf15": {"formula": "sellmeier", "coeffs": {"B": [1.56032691, 0.276257333, 0.947719839], "C": [0.00958633072, 0.0457627625, 99.2753302]}},
}


def _refractive_index_at_wavelength(wvl_nm, material_name, n_fallback):
    """n(λ) from material name (glass library) or fallback. Matches backend glass_materials."""
    if not material_name or not str(material_name).strip():
        return n_fallback
    if n_fallback <= 1.001:
        return 1.0
    key = str(material_name).lower().strip()
    entry = _GLASS_LIBRARY.get(key)
    if entry is None:
        if key.startswith("n-"):
            entry = _GLASS_LIBRARY.get(key[2:])
        if entry is None and key == "n-bk":
            entry = _GLASS_LIBRARY.get("n-bk7")
        if entry is None:
            return n_fallback
    if isinstance(entry, str):
        entry = _GLASS_LIBRARY.get(entry, {})
    if not isinstance(entry, dict):
        return n_fallback
    if entry.get("formula") == "sellmeier":
        coeffs = entry.get("coeffs", {})
        return n_from_sellmeier(wvl_nm, coeffs)
    if entry.get("formula") == "constant":
        return float(entry.get("coeffs", {}).get("n", n_fallback))
    return n_fallback


def get_n_after(surfaces, i, s, wvl_nm):
    """n2 = material of the space between surface i and i+1 (surface i's thickness).
    CRITICAL: optical_stack[i].n applies ONLY to propagation over thickness[i].
    If thickness[i]=95mm and material='Air', n MUST be 1.0 for that entire distance.
    Surface i's row defines n_out. No heuristics — use type/material strictly."""
    if i == len(surfaces) - 1:
        return 1.0  # Last surface: exit into air
    _mat = str(s.get("material") or "").strip().lower()
    _typ = str(s.get("type") or "").strip().lower()
    if _mat == "air" or _typ == "air":
        return 1.0  # Thickness material is air — MUST be 1.0
    return get_n(s, wvl_nm)


def get_n(surface, wvl_nm):
    """Refractive index for surface at wavelength. Never return 0 or null.
    Uses Sellmeier if available, else material lookup from glass library, else refractiveIndex."""
    wvl_nm = float(wvl_nm)
    sellmeier = surface.get("sellmeierCoefficients")
    if sellmeier and isinstance(sellmeier, dict):
        n = n_from_sellmeier(wvl_nm, sellmeier)
    else:
        n_fallback = float(surface.get("refractiveIndex", 1.52) or 1.52)
        material = surface.get("material") or ""
        n = _refractive_index_at_wavelength(wvl_nm, material, n_fallback)
    if np.isnan(n) or n <= 0 or not np.isfinite(n):
        n = float(surface.get("refractiveIndex", 1.52) or 1.52)
    return max(0.1, min(10.0, float(n)))  # Clamp to avoid TIR/division issues


def surface_profile(radius, semi_dia, n_pts=31):
    """(z, y) points for spherical surface. radius=0 -> plano."""
    if radius == 0 or abs(radius) > 1e10:
        return [[0, -semi_dia], [0, semi_dia]]
    R = radius
    y_vals = np.linspace(-semi_dia, semi_dia, n_pts)
    radicand = np.maximum(R**2 - y_vals**2, 0)
    z_vals = R - np.sign(R) * np.sqrt(radicand)
    return [[float(z), float(y)] for z, y in zip(z_vals, y_vals)]


def refract(v_in, normal, n1, n2):
    """Vector form of Snell's law: v_refr = η·v_inc + (η·cos(θi) - cos(θt))·N.
    η = n1/n2. N = unit normal into incident medium."""
    n1, n2 = float(n1), float(n2)
    if n2 < 1e-9:
        return (0, 0, True, {"n1": n1, "n2": n2, "resultant": [0, 0], "msg": "n2 near zero"})
    eta = n1 / n2  # n_prev / n_next
    vx, vy = float(v_in[0]), float(v_in[1])
    nx, ny = float(normal[0]), float(normal[1])
    cos_theta_i = -(nx * vx + ny * vy)  # -N·v_in
    sin2_t = 1.0 - eta * eta * (1.0 - cos_theta_i * cos_theta_i)
    if sin2_t < 0:
        return (0, 0, True, {"n1": n1, "n2": n2, "resultant": [0, 0], "msg": "TIR", "radicand": float(sin2_t)})
    cos_theta_t = np.sqrt(sin2_t)
    # Standard: t = μ·i + (cos_θt - μ·cos_θi)·N_std. We pass N into incident medium (N = -N_std).
    # So coeff = μ·cos_θi - cos_θt.
    coeff = eta * cos_theta_i - cos_theta_t
    out_dz = eta * vx + coeff * nx
    out_dy = eta * vy + coeff * ny
    nrm = np.sqrt(out_dz * out_dz + out_dy * out_dy)
    if nrm < 1e-12:
        return (vx, vy, False, {"n1": n1, "n2": n2, "resultant": [float(vx), float(vy)], "msg": "norm near zero"})
    out_dz, out_dy = out_dz / nrm, out_dy / nrm
    return (float(out_dz), float(out_dy), False, {"n1": n1, "n2": n2, "resultant": [out_dz, out_dy]})


def _log_termination(reason, surf_idx, ray_z, ray_y, extra=None, direction_vector=None, current_z=None, n1=None, n2=None, resultant=None, wvl_nm=None, ray_origin=None):
    """Sanity-check log when a ray terminates. Stored for trace result."""
    global _termination_log
    try:
        msg = {"reason": reason, "surf": surf_idx, "z": float(ray_z), "y": float(ray_y)}
        if ray_origin is not None:
            msg["ray_origin"] = [float(ray_origin[0]), float(ray_origin[1])]
        if direction_vector is not None:
            msg["direction_vector"] = [float(direction_vector[0]), float(direction_vector[1])]
        if current_z is not None:
            msg["current_z"] = float(current_z)
        if n1 is not None:
            msg["n1"] = float(n1)
        if n2 is not None:
            msg["n2"] = float(n2)
        if resultant is not None:
            msg["resultant"] = [float(resultant[0]), float(resultant[1])]
        if wvl_nm is not None:
            msg["wvl_nm"] = float(wvl_nm)
        if extra:
            msg["extra"] = extra
        if len(_termination_log) < 20:
            _termination_log.append(msg)
    except Exception:
        pass


def trace_ray(ray_z, ray_y, ray_dz, ray_dy, surfaces, wvl_nm, cumulative_z, z_target=Z_TARGET, log_refraction=False):
    """Trace one ray through surfaces. Returns [[z,y], ...] in global coords.
    cumulative_z[i] = sum(thicknesses[0..i-1]) = absolute z-vertex of surface i.
    n_incident = index of medium ray traveled through; n_refracted = material FOLLOWING this surface.
    Index hand-off: after each surface, n_before = n_after so next surface gets correct n1."""
    path = []
    n_before = 1.0  # Object space is air
    path.append([float(ray_z), float(ray_y)])
    completed_all = True
    for i, s in enumerate(surfaces):
        if i >= MAX_SURFACES:
            _log_termination(TERM_NUMERICAL, i, ray_z, ray_y, {"msg": "surface limit"}, (ray_dz, ray_dy), cumulative_z[i] if i < len(cumulative_z) else 0, wvl_nm=wvl_nm)
            completed_all = False
            break
        z_vertex = cumulative_z[i]  # Absolute z-vertex of surface i (mm)
        radius = float(s.get("radius", 0) or 0)  # Used as-is; +R = convex toward object
        # n_incident = medium ray traveled through; n_refracted = material FOLLOWING this surface.
        n_after = get_n_after(surfaces, i, s, wvl_nm)
        semi = float(s.get("diameter", 25) or 25) / 2.0

        # Require forward propagation (avoid division by zero)
        if abs(ray_dz) < 1e-12:
            _log_termination(TERM_NUMERICAL, i, ray_z, ray_y, {"msg": "ray_dz near zero"}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
            completed_all = False
            break

        # --- 1. Intersection with surface ---
        if radius == 0 or abs(radius) > 1e10:
            # Plano: t = (surface_z - ray_z) / ray_dz. Check ray_dz != 0.
            z_surf = z_vertex
            if abs(ray_dz) < 1e-12:
                _log_termination(TERM_NUMERICAL, i, ray_z, ray_y, {"msg": "plano ray_dz zero"}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
                completed_all = False
                break
            t_hit = (z_surf - ray_z) / ray_dz
            if t_hit < -1e-12:
                _log_termination(TERM_MISSED, i, ray_z, ray_y,
                    {"msg": "plano t_hit negative", "t_hit": float(t_hit)},
                    (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm,
                    ray_origin=(ray_z, ray_y))
                completed_all = False
                break
            if t_hit < 0:
                t_hit = 0
            y_surf = ray_y + t_hit * ray_dy
            normal = (1.0, 0.0) if ray_dz > 0 else (-1.0, 0.0)
            if ray_dz * normal[0] + ray_dy * normal[1] > 0:
                normal = (-normal[0], -normal[1])
        else:
            # Spherical: Center_Z = Vertex_Z + Radius (signed). R=-100 at z=5 -> center at -95.
            center_z = z_vertex + radius
            Lz = center_z - ray_z
            Ly = 0.0 - ray_y
            a = ray_dz**2 + ray_dy**2
            b = -2.0 * (ray_dz * Lz + ray_dy * Ly)
            c_coef = Lz**2 + Ly**2 - radius**2
            disc = b**2 - 4 * a * c_coef
            if disc < 0:
                _log_termination(TERM_MISSED, i, ray_z, ray_y,
                    {"disc": float(disc), "current_z": float(z_vertex), "center_z": float(center_z), "radius": float(radius)},
                    (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm,
                    ray_origin=(ray_z, ray_y))
                completed_all = False
                break
            sqrt_d = np.sqrt(disc)
            t1 = (-b - sqrt_d) / (2 * a)
            t2 = (-b + sqrt_d) / (2 * a)
            candidates = [t for t in (t1, t2) if t > T_MIN]
            if not candidates:
                _log_termination(TERM_NUMERICAL, i, ray_z, ray_y,
                    {"t1": float(t1), "t2": float(t2), "disc": float(disc), "current_z": float(z_vertex), "msg": "no t > T_MIN"},
                    (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm,
                    ray_origin=(ray_z, ray_y))
                completed_all = False
                break
            t_hit = min(candidates)
            z_surf = ray_z + t_hit * ray_dz
            y_surf = ray_y + t_hit * ray_dy
            nx = (z_surf - center_z) / abs(radius)
            ny = (y_surf - 0) / abs(radius) if abs(radius) > 1e-12 else 0.0
            normal = (nx, ny)
            if ray_dz * nx + ray_dy * ny > 0:
                normal = (-nx, -ny)

        if abs(y_surf) > semi:
            _log_termination(TERM_APERTURE, i, ray_z, ray_y,
                {"y_surf": float(y_surf), "semi": float(semi)},
                (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm,
                ray_origin=(ray_z, ray_y))
            completed_all = False
            break

        # --- 2. Update ray position to P_hit ---
        path.append([z_surf, y_surf])
        hit_z, hit_y = z_surf, y_surf

        # --- 3. Refraction (n_before -> n_after). η = n1/n2. Enter glass: η≈0.67; exit glass: η≈1.5. ---
        t_to_next = float(s.get("thickness", 0) or 0)
        mat_name = str(s.get("material") or s.get("type") or "?").strip()
        eta = float(n_before / n_after) if n_after > 1e-9 else 0.0
        # MATCH AUDIT: If mat_name says Air but n_after != 1.0, material shift bug — stop trace.
        if mat_name.lower() == "air" and abs(n_after - 1.0) > 1e-6:
            raise ValueError(
                f"MATCH AUDIT FAIL | UI Surface {i+1} | Pos: {z_vertex:.2f}mm | Material: {mat_name} | n_after: {n_after:.4f} — Air must have n=1.0"
            )
        v_in = (ray_dz, ray_dy)
        ray_dz, ray_dy, tir, diag = refract(v_in, normal, n_before, n_after)
        if log_refraction and len(_refraction_log) < 50:
            ui_surf = i + 1
            _refraction_log.append({
                "surf": i, "ui_surf": ui_surf, "z_vertex": float(z_vertex),
                "thickness_to_next": t_to_next, "n1": float(n_before), "n2": float(n_after),
                "eta": eta, "mat_name": mat_name,
                "hit_z": float(hit_z), "hit_y": float(hit_y),
                "radius": float(radius), "center_z": float(z_vertex + radius) if radius else 0,
                "v_in": [float(v_in[0]), float(v_in[1])],
                "v_out": [float(ray_dz), float(ray_dy)],
            })
        if tir:
            _log_termination(TERM_TIR, i, hit_z, hit_y, diag, v_in, z_vertex,
                            n1=diag.get("n1"), n2=diag.get("n2"), resultant=diag.get("resultant"), wvl_nm=wvl_nm,
                            ray_origin=(ray_z, ray_y))
            completed_all = False
            break
        if abs(ray_dz) < 1e-12 and abs(ray_dy) < 1e-12:
            _log_termination(TERM_NUMERICAL, i, hit_z, hit_y, diag, v_in, z_vertex,
                            n1=diag.get("n1"), n2=diag.get("n2"), resultant=diag.get("resultant"), wvl_nm=wvl_nm)
            completed_all = False
            break

        # --- 4. Index hand-off: n_before = material ray is now IN (space between this surface and next) ---
        n_before = n_after

        # --- 5. Epsilon nudge: advance along new direction to avoid re-intersection ---
        ray_z = hit_z + ray_dz * NUDGE_EPS
        ray_y = hit_y + ray_dy * NUDGE_EPS

    # --- 6. Final propagation: extend ray to z_target only if ray completed all surfaces ---
    if completed_all and path and abs(ray_dz) > 1e-12 and ray_z < z_target:
        t_ext = (z_target - ray_z) / ray_dz
        if t_ext > 0:
            final_y = ray_y + ray_dy * t_ext
            path.append([float(z_target), float(final_y)])

    return path


def run_trace(optical_stack):
    """Main entry: optical_stack dict -> trace result dict."""
    global _termination_log, _refraction_log
    _termination_log = []
    _refraction_log = []

    surfaces = optical_stack.get("surfaces", [])
    if not surfaces:
        return {"error": "No surfaces", "rays": [], "surfaces": [], "focusZ": 0, "bestFocusZ": 0, "metricsSweep": []}

    epd = float(optical_stack.get("entrancePupilDiameter", 10) or 10)
    wavelengths = optical_stack.get("wavelengths") or [587.6]
    if not wavelengths or not isinstance(wavelengths, (list, tuple)):
        wavelengths = [587.6]
    wavelengths = [float(w or 587.6) for w in wavelengths if w is not None]
    if not wavelengths:
        wavelengths = [587.6]
    # Sort wavelengths [486.1, 587.6, 656.3] for cyan/orange/green color alignment
    wavelengths = sorted(wavelengths)
    num_rays = int(optical_stack.get("numRays", optical_stack.get("num_rays", 9)) or 9)
    field_angles = (optical_stack.get("fieldAngles") or [0])[:3]
    focus_mode = str(optical_stack.get("focusMode", "On-Axis") or "On-Axis")

    # Unified Z-stack: surface_z[i] = sum(thicknesses[0..i-1]). Surface 0 vertex at z=0.
    # Must match frontend computeCumulativeZ exactly. All Z values in mm.
    cumulative_z = [0.0]
    for s in surfaces[:-1]:
        t = float(s.get("thickness", 0) or 0)
        cumulative_z.append(cumulative_z[-1] + t)

    # Build surface profiles (global z)
    z_origin = 0
    surface_profiles = []
    for i, s in enumerate(surfaces):
        r = float(s.get("radius", 0) or 0)
        semi = float(s.get("diameter", 25) or 25) / 2.0
        pts = surface_profile(r, semi)
        for p in pts:
            p[0] += cumulative_z[i]
        surface_profiles.append(pts)
    z_cur = cumulative_z[-1] + float(surfaces[-1].get("thickness", 0) or 0)

    # Paraxial EFL from lens maker's formula (thin-lens approx): 1/f = (n-1)(1/R1 - 1/R2).
    def _paraxial_efl_mm():
        if len(surfaces) < 2:
            return None
        r1 = float(surfaces[0].get("radius", 0) or 0)
        r2 = float(surfaces[1].get("radius", 0) or 0)
        if abs(r1) < 1e-6 or abs(r2) < 1e-6:
            return None
        n = get_n(surfaces[0], wavelengths[0])
        inv_f = (n - 1) * (1 / r1 - 1 / r2)
        return 1 / inv_f if abs(inv_f) > 1e-9 else None

    paraxial_efl = _paraxial_efl_mm()
    # Extend rays past last surface: ~0.6× EFL or 50–150 mm, to show focus without excessive length.
    ext = max(50.0, min((paraxial_efl or 80) * 0.6, Z_TARGET))
    z_target = z_cur + ext

    # Ray fan: N rays per field angle (N = numRays from slider). Total = len(field_angles) * num_rays.
    num_rays = max(2, int(num_rays))
    rays = []
    ray_field_indices = []
    ray_power = []

    for fld_idx, angle_deg in enumerate(field_angles):
        angle_rad = np.radians(float(angle_deg))
        dz0 = float(np.cos(angle_rad))
        dy0 = float(np.sin(angle_rad))
        wvl_nm = wavelengths[0]
        for k in range(num_rays):
            v = (k / max(1, num_rays - 1) - 0.5) * 2 if num_rays > 1 else 0
            y0 = (epd / 2) * v
            log_refraction = fld_idx == 0 and k == 0
            path = trace_ray(RAY_START_Z, y0, dz0, dy0, surfaces, wvl_nm, cumulative_z, z_target, log_refraction=log_refraction)
            if path and len(path) >= 2:
                rays.append(path)
                ray_field_indices.append(fld_idx)
                ray_power.append(0.98)

    if not rays:
        return {
            "error": "No rays traced",
            "rays": [],
            "rayFieldIndices": [],
            "rayPower": [],
            "surfaces": surface_profiles,
            "focusZ": z_cur,
            "bestFocusZ": z_cur,
            "zOrigin": z_origin,
            "terminationLog": _termination_log,
            "refractionLog": _refraction_log,
            "performance": {"rmsSpotRadius": 0, "totalLength": z_cur, "fNumber": 0},
            "metricsSweep": [],
        }

    # Metrics sweep: uses the EXACT same ray paths as visual rays (interpolation only, no separate refraction).
    # z from RAY_START_Z (rays exist) to totalLength*1.5. HUD must show metrics at cursor Z; if sweep
    # starts at 0, cursor at z<0 gets sweep[0] (wrong). Include ray extent so metrics match cursor Z.
    z_sweep_min = RAY_START_Z
    z_sweep_max = z_cur * 1.5

    def _chief_slope_at_z(ray, z):
        """Slope dy/dz of ray at z, or None if ray has no segment containing z."""
        if not ray or len(ray) < 2:
            return None
        for k in range(len(ray) - 1):
            za, zb = ray[k][0], ray[k + 1][0]
            if (za <= z <= zb) or (zb <= z <= za):
                dz_seg = ray[k + 1][0] - ray[k][0]
                return (ray[k + 1][1] - ray[k][1]) / dz_seg if abs(dz_seg) > 1e-12 else 0.0
        return None

    def _compute_sweep(z_lo, z_hi, n_pts=120, ray_subset=None):
        """ray_subset: optional list of ray indices to include. If None, use all rays."""
        use_rays = [rays[i] for i in (ray_subset if ray_subset is not None else range(len(rays)))]
        # Chief ray = ray through pupil center (smallest |y| at first point)
        chief_idx = min(range(len(use_rays)), key=lambda i: abs(use_rays[i][0][1]) if use_rays[i] else float("inf"))
        chief_ray = use_rays[chief_idx] if chief_idx < len(use_rays) else None
        out = []
        for z in np.linspace(z_lo, z_hi, n_pts):
            y_vals = []
            for ray in use_rays:
                for k in range(len(ray) - 1):
                    if ray[k][0] <= z <= ray[k + 1][0] or ray[k + 1][0] <= z <= ray[k][0]:
                        t = (z - ray[k][0]) / (ray[k + 1][0] - ray[k][0]) if ray[k + 1][0] != ray[k][0] else 0
                        y = ray[k][1] + t * (ray[k + 1][1] - ray[k][1])
                        y_vals.append(y)
                        break
            if y_vals:
                y_arr = np.array(y_vals)
                rms = float(np.sqrt(np.mean(y_arr**2) - np.mean(y_arr) ** 2)) if len(y_arr) > 0 else 0
                rms = max(0, rms)
                chief_slope = _chief_slope_at_z(chief_ray, z) if chief_ray else None
                cra = float(np.degrees(np.arctan(chief_slope))) if chief_slope is not None else 0.0
                out.append({"z": float(z), "rmsRadius": rms, "beamWidth": float(np.max(y_arr) - np.min(y_arr)),
                           "chiefRayAngle": cra, "yCentroid": float(np.mean(y_arr)), "numRays": len(y_vals)})
            else:
                out.append({"z": float(z), "rmsRadius": None, "beamWidth": None, "chiefRayAngle": None, "yCentroid": None, "numRays": 0})
        return out

    metrics_sweep = _compute_sweep(z_sweep_min, z_sweep_max, n_pts=200)
    # On-axis rays only for best focus: focus_mode On-Axis must not include off-axis field rays.
    on_axis_indices = [i for i in range(len(rays)) if ray_field_indices[i] == 0]
    focus_sweep = _compute_sweep(z_sweep_min, z_sweep_max, n_pts=200, ray_subset=on_axis_indices) if on_axis_indices else metrics_sweep
    valid_focus_sweep = [m for m in focus_sweep if m.get("rmsRadius") is not None and m["rmsRadius"] >= 0]

    # Best Focus: z where RMS is minimized. Use ON-AXIS rays only (exclude off-axis field rays).
    # REFERENCE PLANE FIX: cap at z_cur + 100 mm to exclude far spread.
    Z_FOCUS_CAP_MM = 100.0
    z_search_max = z_cur + Z_FOCUS_CAP_MM

    def _in_focus_region(m):
        return m["z"] <= z_search_max

    best_focus_z = z_cur
    rms_at_focus = 0.0
    for _ in range(4):  # Max 4 extensions
        search_sweep = [m for m in valid_focus_sweep if _in_focus_region(m)] or valid_focus_sweep
        if search_sweep:
            best_pt = min(search_sweep, key=lambda m: m["rmsRadius"])
            best_idx = next((i for i, m in enumerate(focus_sweep) if m.get("rmsRadius") == best_pt["rmsRadius"] and m["z"] == best_pt["z"]), -1)
            best_focus_z = best_pt["z"]
            rms_at_focus = best_pt["rmsRadius"]
            if best_idx < 0 or (best_idx < len(focus_sweep) - 2 and best_idx > 1):
                break
            if best_idx >= len(focus_sweep) - 2:
                z_sweep_min = z_sweep_max
                z_sweep_max = z_sweep_max * 1.5
                ext_focus = _compute_sweep(z_sweep_min, z_sweep_max, n_pts=80, ray_subset=on_axis_indices)
                ext_full = _compute_sweep(z_sweep_min, z_sweep_max, n_pts=80)
                focus_sweep = sorted(focus_sweep + ext_focus, key=lambda m: m["z"])
                metrics_sweep = sorted(metrics_sweep + ext_full, key=lambda m: m["z"])
                valid_focus_sweep = [m for m in focus_sweep if m.get("rmsRadius") is not None and m["rmsRadius"] >= 0]
            else:
                break
        else:
            break
    focus_z = best_focus_z

    # Rayleigh range: z_R = π * (w0_mm)² / λ_mm. MANDATORY: λ in mm.
    # λ_nm (e.g. 587.6) -> λ_mm = λ_nm * 1e-6. Wrong units cause z_R ≈ 200,000+ mm.
    wvl_nm = float(wavelengths[0] or 587.6)
    lambda_mm = wvl_nm * 1e-6  # Convert nm to mm: 587.6 nm -> 5.876e-4 mm
    m2 = float(optical_stack.get("m2Factor", 1.0) or 1.0)
    m2 = max(0.1, min(10.0, m2))
    w0_mm = 2.0 * rms_at_focus if rms_at_focus > 1e-9 else 0.09
    rayleigh_range = (
        (np.pi * (w0_mm ** 2) / (lambda_mm * m2))
        if lambda_mm > 0 and w0_mm > 0
        else 1.0
    )

    total_length = z_cur
    f_num = total_length / epd if epd > 0 else 0

    # Diagnostic print: captured by setStdout -> postMessage -> main thread console
    if _refraction_log:
        for e in _refraction_log:
            ui = e.get("ui_surf", e["surf"] + 1)
            z = e.get("z_vertex", 0)
            mat = e.get("mat_name", "?")
            n2 = e.get("n2", 0)
            print(f"MATCH AUDIT | UI Surface {ui} | Pos: {z:.2f}mm | Material: {mat} | n_after: {n2:.4f}")
        print(f"bestFocusZ={best_focus_z:.2f} mm (Diamond = visual crossing)")
    if paraxial_efl is not None:
        print(f"Paraxial EFL (thin-lens): {paraxial_efl:.2f} mm | bestFocusZ={best_focus_z:.2f} mm")

    return {
        "rays": rays,
        "rayFieldIndices": ray_field_indices,
        "rayPower": ray_power,
        "surfaces": surface_profiles,
        "focusZ": focus_z,
        "bestFocusZ": best_focus_z,
        "paraxialEflMm": float(paraxial_efl) if paraxial_efl is not None else None,
        "firstLensR1": float(surfaces[0].get("radius", 0) or 0) if surfaces else None,
        "firstLensR2": float(surfaces[1].get("radius", 0) or 0) if len(surfaces) > 1 else None,
        "zOrigin": z_origin,
        "terminationLog": _termination_log,
        "refractionLog": _refraction_log,
        "performance": {
            "rmsSpotRadius": rms_at_focus,
            "totalLength": total_length,
            "fNumber": f_num,
        },
        # HUD and RMS vs Z graph: use on-axis sweep when On-Axis so RMS matches best focus.
        "metricsSweep": focus_sweep if (focus_mode == "On-Axis" and on_axis_indices) else metrics_sweep,
        "gaussianBeam": {
            "beamEnvelope": [],
            "spotSizeAtFocus": 2.0 * rms_at_focus if rms_at_focus > 1e-9 else 0.09,
            "rayleighRange": float(rayleigh_range),
            "waistZ": focus_z,
            "focusZ": focus_z,
        },
    }


def run_chromatic_shift(optical_stack, wavelength_min_nm=400.0, wavelength_max_nm=1100.0, wavelength_step_nm=10.0):
    """
    Chromatic focus shift: for each wavelength, trace on-axis rays and return BFL (mm).
    Returns [{wavelength, focus_shift}, ...] for LCA overlay when backend is unavailable.
    """
    surfaces = optical_stack.get("surfaces", [])
    if not surfaces:
        return []
    epd = float(optical_stack.get("entrancePupilDiameter", 10) or 10)
    num_rays = max(2, int(optical_stack.get("numRays", 9) or 9))

    cumulative_z = [0.0]
    for s in surfaces[:-1]:
        t = float(s.get("thickness", 0) or 0)
        cumulative_z.append(cumulative_z[-1] + t)
    last_vertex_z = cumulative_z[-1]
    z_cur = last_vertex_z + float(surfaces[-1].get("thickness", 0) or 0)
    z_target = z_cur + 100.0
    z_sweep_min = RAY_START_Z
    z_sweep_max = z_cur * 1.5

    wavelengths = []
    w = wavelength_min_nm
    while w <= wavelength_max_nm:
        wavelengths.append(w)
        w += wavelength_step_nm

    def _rms_at_z(rays, z):
        y_vals = []
        for ray in rays:
            for k in range(len(ray) - 1):
                if ray[k][0] <= z <= ray[k + 1][0] or ray[k + 1][0] <= z <= ray[k][0]:
                    t = (z - ray[k][0]) / (ray[k + 1][0] - ray[k][0]) if ray[k + 1][0] != ray[k][0] else 0
                    y_vals.append(ray[k][1] + t * (ray[k + 1][1] - ray[k][1]))
                    break
        if not y_vals:
            return None
        y_arr = np.array(y_vals)
        return float(np.sqrt(np.mean(y_arr**2) - np.mean(y_arr) ** 2))

    result = []
    for wvl_nm in wavelengths:
        rays = []
        dz0, dy0 = 1.0, 0.0
        for k in range(num_rays):
            v = (k / max(1, num_rays - 1) - 0.5) * 2 if num_rays > 1 else 0
            y0 = (epd / 2) * v
            path = trace_ray(RAY_START_Z, y0, dz0, dy0, surfaces, wvl_nm, cumulative_z, z_target, log_refraction=False)
            if path and len(path) >= 2:
                rays.append(path)
        if not rays:
            result.append({"wavelength": float(wvl_nm), "focus_shift": float("nan")})
            continue
        z_sweep = np.linspace(z_sweep_min, min(z_sweep_max, z_cur + 100.0), 200)
        rms_vals = [_rms_at_z(rays, z) for z in z_sweep]
        best_idx = 0
        best_rms = float("inf")
        for i, r in enumerate(rms_vals):
            if r is not None and r < best_rms:
                best_rms = r
                best_idx = i
        z_window_lo = float(z_sweep[max(0, best_idx - 1)])
        z_window_hi = float(z_sweep[min(len(z_sweep) - 1, best_idx + 1)])
        phi = 0.618033988749895
        tol = 1e-6
        a, b = z_window_lo, z_window_hi
        while (b - a) > tol:
            c = b - (b - a) * phi
            d = a + (b - a) * phi
            rc = _rms_at_z(rays, c)
            rd = _rms_at_z(rays, d)
            if rc is None:
                rc = float("inf")
            if rd is None:
                rd = float("inf")
            if rc < rd:
                b = d
            else:
                a = c
        best_z = 0.5 * (a + b)
        bfl = best_z - last_vertex_z if np.isfinite(best_rms) else float("nan")
        result.append({"wavelength": float(wvl_nm), "focus_shift": float(bfl)})
    return result


def run_optimize_colors(optical_stack):
    """
    Find second glass to minimize LCA in doublet. Uses run_chromatic_shift.
    Returns { recommended_glass: str, estimated_lca_reduction: float }.
    """
    surfaces = optical_stack.get("surfaces", [])
    if len(surfaces) < 2:
        return {"recommended_glass": "", "estimated_lca_reduction": 0.0}
    s0, s1 = surfaces[0], surfaces[1]
    mat1 = str(s0.get("material") or "").strip().lower()
    if not mat1 or mat1 == "air":
        return {"recommended_glass": "", "estimated_lca_reduction": 0.0}
    stack = dict(optical_stack)
    stack["surfaces"] = list(surfaces)
    stack["numRays"] = max(2, int(optical_stack.get("numRays", 9) or 9))
    singlet_result = run_chromatic_shift(
        stack, wavelength_min_nm=486.0, wavelength_max_nm=656.0, wavelength_step_nm=170.0
    )
    bfl_486_s = next((p["focus_shift"] for p in singlet_result if abs(p["wavelength"] - 486) < 5), float("nan"))
    bfl_656_s = next((p["focus_shift"] for p in singlet_result if abs(p["wavelength"] - 656) < 5), float("nan"))
    if not (np.isfinite(bfl_486_s) and np.isfinite(bfl_656_s)):
        return {"recommended_glass": "", "estimated_lca_reduction": 0.0}
    lca_singlet = abs(bfl_486_s - bfl_656_s)
    t1 = float(s0.get("thickness", 5) or 5)
    t2 = t1 * 0.5
    r2 = float(s1.get("radius", 0) or 0)
    diam = float(s0.get("diameter", 25) or 25)
    _DISPLAY_NAMES = {
        "fused silica": "Fused Silica", "silica": "Fused Silica", "fused-silica": "Fused Silica",
        "calcium fluoride": "Calcium Fluoride", "caf2": "Calcium Fluoride",
        "magnesium fluoride": "Magnesium Fluoride", "mgf2": "Magnesium Fluoride",
    }
    def _canonical_name(k):
        return _DISPLAY_NAMES.get(k, k.upper().replace("-", "-"))
    candidates = []
    seen = set()
    for k, v in _GLASS_LIBRARY.items():
        if isinstance(v, str):
            continue
        if v.get("formula") != "sellmeier" or k == "air":
            continue
        coeffs = v.get("coeffs", {})
        if "B" not in coeffs or "C" not in coeffs:
            continue
        name = _canonical_name(k)
        if name.lower() == mat1 or name in seen:
            continue
        seen.add(name)
        candidates.append((k, v, name))
    best_glass = ""
    best_lca = float("inf")
    for key, entry, glass_name in candidates:
        cement_sellmeier = {"B": list(entry["coeffs"]["B"]), "C": list(entry["coeffs"]["C"])}
        doublet_surfaces = [
            dict(s0, thickness=t1),
            {"id": "cement", "type": "Glass", "radius": r2, "thickness": t2, "material": glass_name, "refractiveIndex": 1.6, "diameter": diam, "sellmeierCoefficients": cement_sellmeier},
            {"id": "s2", "type": "Air", "radius": r2, "thickness": float(s1.get("thickness", 0) or 0), "material": "Air", "refractiveIndex": 1.0, "diameter": diam},
        ]
        doublet_stack = dict(stack)
        doublet_stack["surfaces"] = doublet_surfaces
        try:
            doublet_result = run_chromatic_shift(
                doublet_stack, wavelength_min_nm=486.0, wavelength_max_nm=656.0, wavelength_step_nm=170.0
            )
            bfl_486 = next((p["focus_shift"] for p in doublet_result if abs(p["wavelength"] - 486) < 5), float("nan"))
            bfl_656 = next((p["focus_shift"] for p in doublet_result if abs(p["wavelength"] - 656) < 5), float("nan"))
            if np.isfinite(bfl_486) and np.isfinite(bfl_656):
                lca = abs(bfl_486 - bfl_656)
                if lca < best_lca:
                    best_lca = lca
                    best_glass = glass_name
        except Exception:
            pass
    if not best_glass:
        return {"recommended_glass": "", "estimated_lca_reduction": 0.0}
    reduction = max(0.0, lca_singlet - best_lca)
    return {"recommended_glass": best_glass, "estimated_lca_reduction": round(float(reduction), 6)}


def parse_import_file_content(content: str) -> list:
    """
    Parse LENS-X or optical JSON file content (string) into surfaces list.
    For use when file content is passed via postMessage (no fetch).
    Handles formatting errors gracefully without crashing the worker.
    Returns list of surface dicts compatible with run_trace, or raises ValueError.
    """
    import json

    if not content or not isinstance(content, str):
        raise ValueError("Expected non-empty string content")

    content = content.strip()
    if not content:
        raise ValueError("Empty file content")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e

    if not isinstance(data, dict):
        raise ValueError("Expected JSON object")

    # LENS-X format: optics.surfaces
    optics = data.get("optics") or {}
    surfaces_raw = optics.get("surfaces") if isinstance(optics, dict) else None

    # Fallback: top-level surfaces / Surfaces / sequence
    if not surfaces_raw:
        for key in ("surfaces", "Surfaces", "sequence", "elements"):
            surfaces_raw = data.get(key)
            if isinstance(surfaces_raw, list):
                break

    if not isinstance(surfaces_raw, list) or len(surfaces_raw) == 0:
        raise ValueError("No surfaces array found in file")

    result = []
    for i, raw in enumerate(surfaces_raw):
        if not isinstance(raw, dict):
            continue
        try:
            r = raw.get("radius") or raw.get("Radius")
            radius = 0.0 if r in ("infinity", "inf", "flat", 0) else float(r or 0)
            thickness = float(raw.get("thickness") or raw.get("Thickness") or 0)
            aperture = float(raw.get("aperture") or raw.get("Aperture") or 12.5)
            diameter = max(0.1, 2 * aperture)
            physics = raw.get("physics") or {}
            n = float(physics.get("refractive_index") or raw.get("refractiveIndex") or 1.52)
            material = str(raw.get("material") or raw.get("Material") or "N-BK7").strip()
            surf_type = str(raw.get("type") or raw.get("Type") or "Glass").lower()
            if surf_type in ("air", "object", "image", "stop"):
                n = 1.0
                material = "Air"
            result.append({
                "id": raw.get("id", f"surf-{i}"),
                "type": "Air" if n <= 1.01 else "Glass",
                "radius": radius,
                "thickness": thickness,
                "refractiveIndex": n,
                "diameter": diameter,
                "material": material,
                "description": str(raw.get("description") or raw.get("Comment") or f"Surface {i + 1}"),
                "coating": physics.get("coating") if isinstance(physics, dict) else None,
                "sellmeierCoefficients": physics.get("sellmeier") if isinstance(physics, dict) else None,
            })
        except (TypeError, ValueError) as e:
            raise ValueError(f"Surface {i + 1}: {e}") from e

    return result

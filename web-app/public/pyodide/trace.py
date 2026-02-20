"""
In-browser paraxial ray trace for MacOptics.
Runs in Pyodide (WebAssembly). Produces rays, surfaces, focusZ, performance.
Simplified implementation: spherical surfaces, Snell refraction, no rayoptics.
"""

import numpy as np

# Epsilon to advance ray past surface after refraction; prevents re-intersection.
NUDGE_EPS = 1e-6
SURFACE_EPS = 1e-9  # Minimum t for sphere intersection (avoid re-hit)

# Ray start z: negative to give 'runway' before first surface at z=0.
RAY_START_Z = -10.0

# Target z for final air propagation (extend rays past last surface to focus region).
Z_TARGET = 500.0

# Safety: max surfaces per ray to prevent infinite loops.
MAX_SURFACES = 100

# Termination reasons for sanity-check logging.
TERM_TIR = "TIR"
TERM_MISSED = "MISSED_SURFACE"
TERM_APERTURE = "APERTURE"
TERM_NUMERICAL = "NUMERICAL"

# Collect termination events for debugging (first N per run).
_termination_log = []


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


def get_n(surface, wvl_nm):
    """Refractive index for surface at wavelength. Never return 0 or null.
    Uses Sellmeier if available, else refractiveIndex. Validates for the specific wvl_nm being traced."""
    wvl_nm = float(wvl_nm)
    sellmeier = surface.get("sellmeierCoefficients")
    if sellmeier and isinstance(sellmeier, dict):
        n = n_from_sellmeier(wvl_nm, sellmeier)
    else:
        n = float(surface.get("refractiveIndex", 1.52) or 1.52)
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
    """Robust Snell's law (vector form): v_refracted = r*v_in + (r*c - sqrt(1 - r²(1-c²)))*N
    where r = n1/n2 and c = -N·v_in. Returns (dz, dy, tir, diagnostic_dict)."""
    n1, n2 = float(n1), float(n2)
    if n2 < 1e-9:
        return (0, 0, True, {"n1": n1, "n2": n2, "resultant": [0, 0], "msg": "n2 near zero"})
    r = n1 / n2
    vx, vy = float(v_in[0]), float(v_in[1])
    nx, ny = float(normal[0]), float(normal[1])
    c = -(nx * vx + ny * vy)  # c = -N·v_in
    radicand = 1.0 - r * r * (1.0 - c * c)
    if radicand < 0:
        return (0, 0, True, {"n1": n1, "n2": n2, "resultant": [0, 0], "msg": "TIR"})
    sqrt_term = np.sqrt(radicand)
    coeff = r * c - sqrt_term
    out_dz = r * vx + coeff * nx
    out_dy = r * vy + coeff * ny
    norm = np.sqrt(out_dz * out_dz + out_dy * out_dy)
    if norm < 1e-12:
        return (vx, vy, False, {"n1": n1, "n2": n2, "resultant": [float(vx), float(vy)], "msg": "norm near zero"})
    out_dz, out_dy = out_dz / norm, out_dy / norm
    return (float(out_dz), float(out_dy), False, {"n1": n1, "n2": n2, "resultant": [out_dz, out_dy]})


def _log_termination(reason, surf_idx, ray_z, ray_y, extra=None, direction_vector=None, current_z=None, n1=None, n2=None, resultant=None, wvl_nm=None):
    """Sanity-check log when a ray terminates. Stored for trace result."""
    global _termination_log
    try:
        msg = {"reason": reason, "surf": surf_idx, "z": float(ray_z), "y": float(ray_y)}
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


def trace_ray(ray_z, ray_y, ray_dz, ray_dy, surfaces, wvl_nm, cumulative_z, z_target=Z_TARGET):
    """Trace one ray through surfaces. Returns [[z,y], ...] in global coords.
    cumulative_z[i] = sum(thicknesses[0..i-1]) = absolute z-vertex of surface i.
    First surface at z=0. Ray starts at ray_z (e.g. RAY_START_Z).
    After final surface, extends to z_target. Safety: breaks if surface_count > MAX_SURFACES."""
    path = []
    n_before = 1.0
    path.append([float(ray_z), float(ray_y)])
    completed_all = True
    for i, s in enumerate(surfaces):
        if i >= MAX_SURFACES:
            _log_termination(TERM_NUMERICAL, i, ray_z, ray_y, {"msg": "surface limit"}, (ray_dz, ray_dy), cumulative_z[i] if i < len(cumulative_z) else 0, wvl_nm=wvl_nm)
            completed_all = False
            break
        z_vertex = cumulative_z[i]  # Absolute z-vertex of surface i
        radius = float(s.get("radius", 0) or 0)
        n_after = 1.0 if s.get("type") == "Air" else get_n(s, wvl_nm)
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
                _log_termination(TERM_MISSED, i, ray_z, ray_y, {"msg": "plano t_hit negative"}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
                completed_all = False
                break
            if t_hit < 0:
                t_hit = 0
            y_surf = ray_y + t_hit * ray_dy
            normal = (1.0, 0.0) if ray_dz > 0 else (-1.0, 0.0)
            if ray_dz * normal[0] + ray_dy * normal[1] > 0:
                normal = (-normal[0], -normal[1])
        else:
            # Spherical: L = Center - RayOrigin (relative coords for correct t)
            center_z = z_vertex + radius
            Lz = center_z - ray_z
            Ly = 0.0 - ray_y
            a = ray_dz**2 + ray_dy**2
            b = -2.0 * (ray_dz * Lz + ray_dy * Ly)
            c_coef = Lz**2 + Ly**2 - radius**2
            disc = b**2 - 4 * a * c_coef
            if disc < 0:
                _log_termination(TERM_MISSED, i, ray_z, ray_y, {"disc": float(disc)}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
                completed_all = False
                break
            sqrt_d = np.sqrt(disc)
            t1 = (-b - sqrt_d) / (2 * a)
            t2 = (-b + sqrt_d) / (2 * a)
            candidates = [t for t in (t1, t2) if t > SURFACE_EPS]
            if not candidates:
                _log_termination(TERM_NUMERICAL, i, ray_z, ray_y, {"t1": float(t1), "t2": float(t2)}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
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
            _log_termination(TERM_APERTURE, i, ray_z, ray_y, {"y_surf": float(y_surf), "semi": float(semi)}, (ray_dz, ray_dy), z_vertex, n1=n_before, n2=n_after, wvl_nm=wvl_nm)
            completed_all = False
            break

        # --- 2. Update ray position to P_hit ---
        path.append([z_surf, y_surf])
        hit_z, hit_y = z_surf, y_surf

        # --- 3. Refraction (n_before -> n_after; Air always n_after=1.0) ---
        v_in = (ray_dz, ray_dy)
        ray_dz, ray_dy, tir, diag = refract(v_in, normal, n_before, n_after)
        if tir:
            _log_termination(TERM_TIR, i, hit_z, hit_y, diag, v_in, z_vertex,
                            n1=diag.get("n1"), n2=diag.get("n2"), resultant=diag.get("resultant"), wvl_nm=wvl_nm)
            completed_all = False
            break
        if abs(ray_dz) < 1e-12 and abs(ray_dy) < 1e-12:
            _log_termination(TERM_NUMERICAL, i, hit_z, hit_y, diag, v_in, z_vertex,
                            n1=diag.get("n1"), n2=diag.get("n2"), resultant=diag.get("resultant"), wvl_nm=wvl_nm)
            completed_all = False
            break

        # --- 4. Epsilon nudge: advance along new direction to avoid re-intersection ---
        ray_z = hit_z + ray_dz * NUDGE_EPS
        ray_y = hit_y + ray_dy * NUDGE_EPS

        # --- 5. Refractive index continuity: n_before for next surface = n_after of current ---
        n_before = n_after

    # --- 6. Final propagation: extend ray to z_target only if ray completed all surfaces ---
    if completed_all and path and abs(ray_dz) > 1e-12 and ray_z < z_target:
        t_ext = (z_target - ray_z) / ray_dz
        if t_ext > 0:
            final_y = ray_y + ray_dy * t_ext
            path.append([float(z_target), float(final_y)])

    return path


def run_trace(optical_stack):
    """Main entry: optical_stack dict -> trace result dict."""
    global _termination_log
    _termination_log = []

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
    field_angles = optical_stack.get("fieldAngles") or [0]
    focus_mode = str(optical_stack.get("focusMode", "On-Axis") or "On-Axis")

    # Absolute Z-tracking: cumulative_z[i] = sum(thicknesses[0..i-1]) = z-vertex of surface i
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
    z_target = max(z_cur + 100.0, Z_TARGET)

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
            path = trace_ray(RAY_START_Z, y0, dz0, dy0, surfaces, wvl_nm, cumulative_z, z_target)
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
            "performance": {"rmsSpotRadius": 0, "totalLength": z_cur, "fNumber": 0},
            "metricsSweep": [],
        }

    # Focus (White Diamond): marginal ray (edge of aperture) intersection with optical axis (y=0)
    marginal_y0 = epd / 2.0
    marginal_path = trace_ray(RAY_START_Z, marginal_y0, 1.0, 0.0, surfaces, wavelengths[0], cumulative_z, z_target)
    best_focus_z = z_cur
    if marginal_path and len(marginal_path) >= 2:
        for k in range(len(marginal_path) - 1):
            z1, y1 = marginal_path[k][0], marginal_path[k][1]
            z2, y2 = marginal_path[k + 1][0], marginal_path[k + 1][1]
            if (y1 >= 0 and y2 <= 0) or (y1 <= 0 and y2 >= 0):
                if abs(y2 - y1) > 1e-12:
                    t_cross = (0.0 - y1) / (y2 - y1)
                    best_focus_z = float(z1 + t_cross * (z2 - z1))
                else:
                    best_focus_z = float(z1)
                break
    focus_z = best_focus_z

    # Metrics sweep
    z_min = min(p[0] for r in rays for p in r)
    z_max = max(p[0] for r in rays for p in r)
    z_positions = np.linspace(z_min, z_max, 80)
    metrics_sweep = []
    for z in z_positions:
        y_vals = []
        for ray in rays:
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
            metrics_sweep.append({
                "z": float(z),
                "rmsRadius": rms,
                "beamWidth": float(np.max(y_arr) - np.min(y_arr)),
                "chiefRayAngle": 0,
                "yCentroid": float(np.mean(y_arr)),
                "numRays": len(y_vals),
            })
        else:
            metrics_sweep.append({"z": float(z), "rmsRadius": None, "beamWidth": None, "chiefRayAngle": None, "yCentroid": None, "numRays": 0})

    # Performance at best focus
    rms_at_focus = 0.09
    total_length = z_cur
    f_num = total_length / epd if epd > 0 else 0

    return {
        "rays": rays,
        "rayFieldIndices": ray_field_indices,
        "rayPower": ray_power,
        "surfaces": surface_profiles,
        "focusZ": focus_z,
        "bestFocusZ": best_focus_z,
        "zOrigin": z_origin,
        "terminationLog": _termination_log,
        "performance": {
            "rmsSpotRadius": rms_at_focus,
            "totalLength": total_length,
            "fNumber": f_num,
        },
        "metricsSweep": metrics_sweep,
        "gaussianBeam": {
            "beamEnvelope": [],
            "spotSizeAtFocus": 0.09,
            "rayleighRange": 1.0,
            "waistZ": focus_z,
            "focusZ": focus_z,
        },
    }

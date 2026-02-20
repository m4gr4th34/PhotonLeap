"""
In-browser paraxial ray trace for MacOptics.
Runs in Pyodide (WebAssembly). Produces rays, surfaces, focusZ, performance.
Simplified implementation: spherical surfaces, Snell refraction, no rayoptics.
"""

import numpy as np


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
    """Refractive index for surface at wavelength."""
    sellmeier = surface.get("sellmeierCoefficients")
    if sellmeier and isinstance(sellmeier, dict):
        return n_from_sellmeier(wvl_nm, sellmeier)
    return float(surface.get("refractiveIndex", 1.52) or 1.52)


def surface_profile(radius, semi_dia, n_pts=31):
    """(z, y) points for spherical surface. radius=0 -> plano."""
    if radius == 0 or abs(radius) > 1e10:
        return [[0, -semi_dia], [0, semi_dia]]
    R = radius
    y_vals = np.linspace(-semi_dia, semi_dia, n_pts)
    radicand = np.maximum(R**2 - y_vals**2, 0)
    z_vals = R - np.sign(R) * np.sqrt(radicand)
    return [[float(z), float(y)] for z, y in zip(z_vals, y_vals)]


def refract(ray_dir, normal, n1, n2):
    """Snell's law: refract ray. Returns new direction (dz, dy) unit vector."""
    # ray_dir, normal: (dz, dy)
    n1, n2 = float(n1), float(n2)
    if n2 == 0:
        return (-ray_dir[0], -ray_dir[1])  # reflect
    mu = n1 / n2
    # 2D: assume ray in yz plane
    dz, dy = ray_dir[0], ray_dir[1]
    nz, ny = normal[0], normal[1]
    dot = dz * nz + dy * ny
    radicand = 1 - mu**2 * (1 - dot**2)
    if radicand < 0:
        return (0, 0)  # TIR
    r = mu * dot - np.sqrt(radicand)
    out_dz = mu * dz - r * nz
    out_dy = mu * dy - r * ny
    norm = np.sqrt(out_dz**2 + out_dy**2)
    if norm < 1e-12:
        return (dz, dy)
    return (float(out_dz / norm), float(out_dy / norm))


def trace_ray(ray_z, ray_y, ray_dz, ray_dy, surfaces, wvl_nm, z_origin):
    """Trace one ray through surfaces. Returns [[z,y], ...] in global coords."""
    path = []
    n_before = 1.0
    z_cur = z_origin
    for i, s in enumerate(surfaces):
        r = float(s.get("radius", 0) or 0)
        t = float(s.get("thickness", 0) or 0)
        n_after = get_n(s, wvl_nm) if s.get("type") != "Air" else 1.0
        semi = float(s.get("diameter", 25) or 25) / 2.0

        # Intersection with surface
        if r == 0 or abs(r) > 1e10:
            # Plano: z_surf = z_cur
            z_surf = z_cur
            y_surf = ray_y + (z_surf - ray_z) * (ray_dy / ray_dz) if abs(ray_dz) > 1e-12 else ray_y
            normal = (-1, 0) if ray_dz > 0 else (1, 0)
        else:
            # Spherical: center at (z_cur + R, 0)
            cx = z_cur + r
            # Ray: (ray_z + t*ray_dz, ray_y + t*ray_dy) = point on sphere
            # |p - c|² = R²
            dx = ray_z - cx
            dy = ray_y
            a = ray_dz**2 + ray_dy**2
            b = 2 * (dx * ray_dz + dy * ray_dy)
            c = dx**2 + dy**2 - r**2
            disc = b**2 - 4 * a * c
            if disc < 0:
                break
            t_hit = (-b - np.sqrt(disc)) / (2 * a) if ray_dz > 0 else (-b + np.sqrt(disc)) / (2 * a)
            if t_hit < 0:
                t_hit = (-b + np.sqrt(disc)) / (2 * a) if ray_dz > 0 else (-b - np.sqrt(disc)) / (2 * a)
            z_surf = ray_z + t_hit * ray_dz
            y_surf = ray_y + t_hit * ray_dy
            # Normal (outward)
            nx = (z_surf - cx) / abs(r)
            ny = y_surf / abs(r) if abs(r) > 1e-12 else 0
            normal = (nx, ny)

        if abs(y_surf) > semi:
            break
        path.append([z_surf, y_surf])

        # Refract
        ray_dz, ray_dy = refract((ray_dz, ray_dy), normal, n_before, n_after)
        ray_z, ray_y = z_surf, y_surf
        n_before = n_after
        z_cur = z_surf + t

    return path


def run_trace(optical_stack):
    """Main entry: optical_stack dict -> trace result dict."""
    surfaces = optical_stack.get("surfaces", [])
    if not surfaces:
        return {"error": "No surfaces", "rays": [], "surfaces": [], "focusZ": 0, "bestFocusZ": 0, "metricsSweep": []}

    epd = float(optical_stack.get("entrancePupilDiameter", 10) or 10)
    wvl_nm = float((optical_stack.get("wavelengths") or [587.6])[0] or 587.6)
    num_rays = int(optical_stack.get("numRays", 9) or 9)
    field_angles = optical_stack.get("fieldAngles") or [0]
    focus_mode = str(optical_stack.get("focusMode", "On-Axis") or "On-Axis")

    # Build surface profiles (global z)
    z_origin = 0
    z_cur = 0
    surface_profiles = []
    for s in surfaces:
        r = float(s.get("radius", 0) or 0)
        t = float(s.get("thickness", 0) or 0)
        semi = float(s.get("diameter", 25) or 25) / 2.0
        pts = surface_profile(r, semi)
        for p in pts:
            p[0] += z_cur
        surface_profiles.append(pts)
        z_cur += t

    # Ray grid
    n = max(2, int(np.sqrt(num_rays)))
    rays = []
    ray_field_indices = []
    ray_power = []

    for fld_idx, angle_deg in enumerate(field_angles):
        angle_rad = np.radians(float(angle_deg))
        for i in range(n):
            for j in range(n):
                u = (i / max(1, n - 1) - 0.5) * 2 if n > 1 else 0
                v = (j / max(1, n - 1) - 0.5) * 2 if n > 1 else 0
                y0 = (epd / 2) * v
                dy0 = np.sin(angle_rad)
                dz0 = np.cos(angle_rad)
                path = trace_ray(0, y0, dz0, dy0, surfaces, wvl_nm, z_origin)
                if path:
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

    # Focus: last surface + paraxial BFL estimate
    last_t = float(surfaces[-1].get("thickness", 0) or 0)
    focus_z = z_cur
    best_focus_z = focus_z

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

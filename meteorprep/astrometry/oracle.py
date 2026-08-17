"""First-principles gnomonic (TAN) geometry — the unit-test oracle of §4.1.

Geometry: the celestial pole is ``pole_offaxis_deg`` off the optical axis.
Working frame: z-axis = celestial pole, tangent point T in the x-z plane.

    T       = (sin Ω, 0, cos Ω)                 with Ω = pole_offaxis_deg
    e_east  = (0, 1, 0)
    e_north = (-cos Ω, 0, sin Ω)
    star    s(ρ, ψ) = (sinρ cosψ, sinρ sinψ, cosρ)   ρ = pole distance
    ξ = (s·e_east)/(s·T),  η = (s·e_north)/(s·T)
    X = f·ξ, Y = f·η ;  projected pole Q = (0, f·tanΩ)

A sky rotation about the pole advances ψ.  The residual of the best 2D
rotation about Q (free angle) is the *irreducible* error a rotate-and-stack
workflow cannot remove; a naive rotation uses α = Δθ exactly.

This module is deliberately independent of astropy: production code uses
WCS + ``reproject``; the tests require the two to agree to < 0.1 px.
"""

from __future__ import annotations

import numpy as np

# Reference rig (spec §Key Findings #2): 16 mm / 6.55 µm → 2442.7 px.
FOCAL_PX = 16.0 / 0.00655
SIDEREAL_DEG_PER_HOUR = 360.0 / 86164.0905 * 3600.0  # 15.041


class GnomonicOracle:
    def __init__(self, focal_px: float = FOCAL_PX, pole_offaxis_deg: float = 35.0):
        self.f = float(focal_px)
        om = np.deg2rad(pole_offaxis_deg)
        self.T = np.array([np.sin(om), 0.0, np.cos(om)])
        self.e_east = np.array([0.0, 1.0, 0.0])
        self.e_north = np.array([-np.cos(om), 0.0, np.sin(om)])
        self.pole_xy = np.array([0.0, self.f * np.tan(om)])

    # -- sphere <-> plane -------------------------------------------------

    @staticmethod
    def star(rho_deg, psi_deg) -> np.ndarray:
        """Unit vector for a star at pole distance rho, azimuth psi (deg)."""
        rho = np.deg2rad(np.asarray(rho_deg, dtype=float))
        psi = np.deg2rad(np.asarray(psi_deg, dtype=float))
        return np.stack([np.sin(rho) * np.cos(psi),
                         np.sin(rho) * np.sin(psi),
                         np.cos(rho)], axis=-1)

    def project(self, s: np.ndarray) -> np.ndarray:
        """Gnomonic projection of unit vector(s) to pixel offsets (X, Y)."""
        s = np.asarray(s, dtype=float)
        d = s @ self.T
        return np.stack([self.f * (s @ self.e_east) / d,
                         self.f * (s @ self.e_north) / d], axis=-1)

    def unproject(self, xy: np.ndarray) -> np.ndarray:
        xy = np.asarray(xy, dtype=float)
        v = (self.T
             + (xy[..., :1] / self.f) * self.e_east
             + (xy[..., 1:2] / self.f) * self.e_north)
        return v / np.linalg.norm(v, axis=-1, keepdims=True)

    @staticmethod
    def rotate_sky(s: np.ndarray, dtheta_deg: float) -> np.ndarray:
        """Advance the sky by dtheta about the pole (z-axis)."""
        a = np.deg2rad(dtheta_deg)
        R = np.array([[np.cos(a), -np.sin(a), 0.0],
                      [np.sin(a), np.cos(a), 0.0],
                      [0.0, 0.0, 1.0]])
        return np.asarray(s) @ R.T

    def field_angle_deg(self, s: np.ndarray) -> float:
        return float(np.rad2deg(np.arccos(np.clip(np.asarray(s) @ self.T, -1, 1))))

    # -- residuals of a 2D rotation about the projected pole --------------

    @staticmethod
    def _rot2d(p, center, alpha_deg):
        a = np.deg2rad(alpha_deg)
        R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        return center + (np.asarray(p) - center) @ R.T

    def residuals(self, rho_deg: float, psi_deg: float,
                  dtheta_deg: float = SIDEREAL_DEG_PER_HOUR):
        """(naive, irreducible) 2D-rotation residual in px for one star.

        naive       : rotate by exactly dtheta about the projected pole Q.
        irreducible : best free-angle rotation about Q — the distance from
                      the true endpoint B to the circle about Q through A.
        """
        s0 = self.star(rho_deg, psi_deg)
        s1 = self.rotate_sky(s0, dtheta_deg)
        A, B = self.project(s0), self.project(s1)
        naive = float(np.linalg.norm(B - self._rot2d(A, self.pole_xy, dtheta_deg)))
        irreducible = float(abs(np.linalg.norm(B - self.pole_xy)
                                - np.linalg.norm(A - self.pole_xy)))
        return naive, irreducible

    def residual_table(self, dtheta_deg: float = SIDEREAL_DEG_PER_HOUR):
        """Reproduce the spec's 26/154/720 px/hr table (Key Finding #3).

        Probe stars:
          - rho=10, psi=90            (field angle ~36-40 deg)
          - rho=25, worst in-frame    (field angle ~48 deg)
          - rho=45, psi=90            (the 40-50 deg corner, field ~55 deg)
          - rho=45, psi=0             (near the optical axis, field ~10 deg)
        """
        half_w = self.f * np.tan(np.deg2rad(48.35))   # HFOV/2
        half_h = self.f * np.tan(np.deg2rad(36.85))   # VFOV/2

        def worst_in_frame(rho):
            worst = (0.0, 0.0)
            for psi in np.linspace(0.0, 360.0, 721):
                A = self.project(self.star(rho, psi))
                if abs(A[0]) > half_w or abs(A[1]) > half_h:
                    continue
                n, b = self.residuals(rho, psi, dtheta_deg)
                if b > worst[1]:
                    worst = (n, b)
            return worst

        return {
            "pole10": self.residuals(10.0, 90.0, dtheta_deg),
            "pole25": worst_in_frame(25.0),
            "corner": self.residuals(45.0, 90.0, dtheta_deg),
            "near_axis45": self.residuals(45.0, 0.0, dtheta_deg),
        }

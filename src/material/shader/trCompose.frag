alpha = velocityDisocclusion > 0.001 ? 0. : (alpha + 0.025);
alpha = clamp(alpha, 0., 1.);

float m = blend;

if (velocityDisocclusion > 0.2) m -= max(0.5, velocityDisocclusion) - 0.2;

if (!isMoving) {
    if (alpha == 1.0) {
        if (samples > 32.) m = max(m, 0.985);
    } else if (alpha < 0.5) {
        if (samples > 32.) m -= 0.5 * (1. - alpha);
    }
}

m = clamp(m, 0., 1.);

outputColor = mix(accumulatedColor, inputColor, 1.0 - m);

// outputColor = vec3(m);
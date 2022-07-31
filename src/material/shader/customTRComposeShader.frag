// the compose shader when Temporal Resolve is enabled
float alpha = 1.;

outputColor = accumulatedTexel.rgb * temporalResolveMix + inputTexel.rgb * (1. - temporalResolveMix);

// if (movement > 0.2) outputColor = vec3(0., 1., 0.);
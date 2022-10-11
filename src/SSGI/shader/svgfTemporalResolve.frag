gOutput = vec4(undoColorTransform(outputColor), alpha);

vec3 rawColor = textureLod(rawInputTexture, vUv, 0.).rgb;

const vec3 W = vec3(0.2125, 0.7154, 0.0721);

vec2 moments = vec2(0.);
moments.r = dot(rawColor, W);
moments.g = moments.r * moments.r;

vec4 historyMoments = textureLod(momentsTexture, reprojectedUv, 0.);

float momentsAlpha = 0.;
if (alpha > FLOAT_EPSILON) {
    momentsAlpha = historyMoments.a + ALPHA_STEP;
}

pixelSample = momentsAlpha / ALPHA_STEP + 1.0;
temporalResolveMix = 1. - 1. / pixelSample;
temporalResolveMix = min(temporalResolveMix, 0.8);

// float momentAlpha = blend;
gMoment = vec4(mix(moments, historyMoments.rg, temporalResolveMix), 0., momentsAlpha);
gOutput = vec4(undoColorTransform(outputColor), alpha);

if (isReprojectedUvValid) {
    vec3 rawColor = textureLod(inputTexture, vUv, 0.).rgb;

    const vec3 W = vec3(0.2125, 0.7154, 0.0721);

    vec2 moments = vec2(0.);
    moments.r = dot(rawColor, W);
    moments.g = moments.r * moments.r;

    vec4 historyMoments = textureLod(momentsTexture, reprojectedUv, 0.);

    float momentsAlpha = 0.;
    if (alpha > FLOAT_EPSILON) {
        momentsAlpha = historyMoments.a + ALPHA_STEP;
    }

    float momentAlpha = 0.8;
    gMoment = vec4(mix(moments, historyMoments.rg, momentAlpha), 0., momentsAlpha);
} else {
    gMoment = vec4(0., 10.0e4, 0., 0.);
}
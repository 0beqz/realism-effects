gOutput = vec4(undoColorTransform(outputColor), alpha);

if (isReprojectedUvValid) {
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);

    vec4 historyMoments = textureLod(lastMomentsTexture, reprojectedUv, 0.);

    vec2 moments = vec2(0.);
    moments.r = dot(inputTexel.rgb, W);
    moments.g = moments.r * moments.r;

    temporalResolveMix = clamp(temporalResolveMix, 0.8, 0.99);

    moments = mix(moments, historyMoments.rg, temporalResolveMix);

    gMoment = vec4(moments, 0.0, 0.0);
} else {
    // boost new samples
    gMoment = vec4(0., 10.0e4, 0., 0.);
}
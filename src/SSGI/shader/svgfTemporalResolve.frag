gOutput = vec4(undoColorTransform(outputColor), alpha);

if (isReprojectedUvValid) {
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);

    vec4 historyMoments = textureLod(lastMomentsTexture, reprojectedUv, 0.);

    vec2 moments = vec2(0.);
    moments.r = dot(inputTexel.rgb, W);
    moments.g = moments.r * moments.r;

    if (temporalResolveMix > 0.99) temporalResolveMix = 0.99;

    moments = mix(moments, historyMoments.rg, temporalResolveMix);

    vec3 worldNormal = unpackRGBToNormal(worldNormalTexel.xyz);

    vec3 dx = dFdx(worldNormal);
    vec3 dy = dFdy(worldNormal);

    float x = dot(dx, dx);
    float y = dot(dy, dy);

    float curvature = sqrt(max(x, y));

    gMoment = vec4(moments, curvature, 0.0);
} else {
    // boost new samples
    gMoment = vec4(0., 10.0e4, 0., 0.);
}
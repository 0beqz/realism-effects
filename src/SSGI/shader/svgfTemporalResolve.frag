bool isDiffuseSample = inputTexel.a == 1.0;

if (!isDiffuseSample) inputColor = accumulatedColor;

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
#define luminance(a) dot(W, a)

vec4 moments, historyMoments;
float momentsTemporalResolveMix = max(temporalResolveMix, 0.8);

// diffuse
if (isReprojectedUvValid) {
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);
    gOutput = vec4(outputColor, alpha);

    // diffuse moments
    historyMoments = textureLod(lastMomentsTexture, reprojectedUv, 0.);

    moments.r = luminance(gOutput.rgb);
    moments.g = moments.r * moments.r;

    moments.rg = mix(moments.rg, historyMoments.rg, momentsTemporalResolveMix);
} else {
    gOutput = vec4(inputColor, 0.);

    // boost new samples
    moments.rg = vec2(0., 1000.);
}

// specular
vec4 specularTexel = textureLod(specularTexture, uv, 0.);
vec3 specularColor = specularTexel.rgb;
float rayLength = specularTexel.a;
bool canReprojectHitPoint = rayLength != 0.0;

vec2 reprojectedUvSpecular = canReprojectHitPoint ? reprojectHitPoint(worldPos, rayLength, uv, depth) : vec2(0.);
bool isReprojectedUvSpecularValid = canReprojectHitPoint && validateReprojectedUV(reprojectedUv, depth, worldPos, worldNormalTexel);

bool anyReprojectionValid = isReprojectedUvSpecularValid || isReprojectedUvValid;

// choose which UV coordinates to use when reprojecting specular lighting
vec2 specularUv = anyReprojectionValid ? (isReprojectedUvSpecularValid ? reprojectedUvSpecular : reprojectedUv) : vec2(0.);

if (anyReprojectionValid) {
    vec4 lastSpecularTexel = textureLod(lastSpecularTexture, specularUv, 0.);
    vec3 lastSpecular = lastSpecularTexel.rgb;
    float specularAlpha = max(lastSpecularTexel.a, 1.);

    vec3 specular = isDiffuseSample ? lastSpecular : specularColor;

    if (!isDiffuseSample) specularAlpha += 1.0;

    temporalResolveMix = 1. - 1. / specularAlpha;
    temporalResolveMix = min(temporalResolveMix, blend);

    gOutput2 = vec4(mix(specular, lastSpecular, temporalResolveMix), specularAlpha);

    // specular moments
    historyMoments = textureLod(lastMomentsTexture, specularUv, 0.);

    moments.b = luminance(gOutput2.rgb);
    moments.a = moments.b * moments.b;

    moments.ba = mix(moments.ba, historyMoments.ba, momentsTemporalResolveMix);
} else {
    gOutput2 = vec4(specularColor, 0.);

    // boost new samples
    moments.ba = vec2(0., 1000.);
}

gMoment = moments;

// gOutput.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// variance = abs(variance);
// gOutput.xyz = vec3(variance);
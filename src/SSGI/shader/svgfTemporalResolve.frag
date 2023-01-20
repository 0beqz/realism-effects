if (dot(inputColor, inputColor) == 0.0) inputColor = accumulatedColor;

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec4 moment, historyMoment;
float momentTemporalResolveMix = max(blend, 0.8);

// diffuse
if (isReprojectedUvValid) {
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);
    gDiffuse = vec4(outputColor, alpha);

    // diffuse moment
    historyMoment = textureLod(lastMomentTexture, reprojectedUv, 0.);

    moment.r = luminance(gDiffuse.rgb);
    moment.g = moment.r * moment.r;
} else {
    gDiffuse = vec4(inputColor, 0.);

    // boost new samples
    moment.rg = vec2(0., 10.);
}

// specular
vec4 specularTexel = textureLod(specularTexture, uv, 0.);
vec3 specularColor = specularTexel.rgb;
float rayLength = specularTexel.a;
bool canReprojectHitPoint = rayLength != 0.0;

vec2 reprojectedUvSpecular = canReprojectHitPoint ? reprojectHitPoint(worldPos, rayLength, uv, depth) : vec2(0.);
bool isReprojectedUvSpecularValid = canReprojectHitPoint && validateReprojectedUV(reprojectedUv, depth, worldPos, worldNormal);

bool anyReprojectionValid = isReprojectedUvSpecularValid || isReprojectedUvValid;

// choose which UV coordinates to use when reprojecting specular lighting
vec2 specularUv = anyReprojectionValid ? (isReprojectedUvSpecularValid ? reprojectedUvSpecular : reprojectedUv) : vec2(0.);

if (anyReprojectionValid) {
#ifdef catmullRomSampling
    vec4 lastSpecularTexel = SampleTextureCatmullRom(lastSpecularTexture, specularUv, 1.0 / invTexSize);
#else
    vec4 lastSpecularTexel = textureLod(lastSpecularTexture, specularUv, 0.0);
#endif

    vec3 lastSpecular = lastSpecularTexel.rgb;
    float specularAlpha = max(lastSpecularTexel.a, 1.);

    bool wasSpecularSampled = dot(specularColor, specularColor) != 0.0;

    if (wasSpecularSampled)
        specularAlpha++;
    else
        specularColor = lastSpecular;

    temporalResolveMix = 1. - 1. / specularAlpha;
    temporalResolveMix = min(temporalResolveMix, maxValue);

    float pixelFrames = max(1., specularAlpha - 1.);
    float a = 1. - 1. / pixelFrames;
    if (didMove && a > blend) specularAlpha = 1. / (1. - blend);

    float roughness = inputTexel.a;
    float glossines = max(0., 0.01 - roughness) / 0.01;
    temporalResolveMix *= 1. - glossines;

    gSpecular = vec4(mix(specularColor, lastSpecular, temporalResolveMix), specularAlpha);

    // specular moment
    historyMoment = textureLod(lastMomentTexture, specularUv, 0.);

    moment.b = luminance(gSpecular.rgb);
    moment.a = moment.b * moment.b;
} else {
    gSpecular = vec4(specularColor, 0.);

    // boost new samples
    moment.ba = vec2(0., 10.);
}

gMoment = mix(moment, historyMoment, momentTemporalResolveMix);

// if (isReprojectedUvSpecularValid)
//     gSpecular.xyz = vec3(0., 1., 0.);
// else
//     gSpecular.xyz = vec3(0., 0., 0.);

// gDiffuse.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// variance = abs(variance);
// gDiffuse.xyz = vec3(variance);

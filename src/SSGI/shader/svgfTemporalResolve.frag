if (dot(inputColor, inputColor) == 0.0) inputColor = accumulatedColor;

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
#define luminance(a) dot(W, a)

vec4 moment, historyMoment;
float momentTemporalResolveMix = max(blend, 0.8);

// diffuse
if (isReprojectedUvValid) {
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);
    gOutput = vec4(outputColor, alpha);

    // diffuse moment
    historyMoment = textureLod(lastMomentTexture, reprojectedUv, 0.);

    moment.r = luminance(gOutput.rgb);
    moment.g = moment.r * moment.r;

    moment.rg = mix(moment.rg, historyMoment.rg, momentTemporalResolveMix);
} else {
    gOutput = vec4(inputColor, 0.);

    // boost new samples
    moment.rg = vec2(0., 10.);
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

    gOutput2 = vec4(mix(specularColor, lastSpecular, temporalResolveMix), specularAlpha);

    // specular moment
    historyMoment = textureLod(lastMomentTexture, specularUv, 0.);

    moment.b = luminance(gOutput2.rgb);
    moment.a = moment.b * moment.b;

    moment.ba = mix(moment.ba, historyMoment.ba, momentTemporalResolveMix);
} else {
    gOutput2 = vec4(specularColor, 0.);

    // boost new samples
    moment.ba = vec2(0., 10.);
}

gMoment = moment;

// gOutput.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// variance = abs(variance);
// gOutput.xyz = vec3(variance);

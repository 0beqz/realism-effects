#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

gDiffuse = vec4(mix(inputColor, accumulatedColor, reprojectedUv.x != -1. ? temporalResolveMix : 0.0), alpha);

vec4 moment, historyMoment;

#if !defined(diffuseOnly) && !defined(specularOnly)
// specular
vec4 specularTexel = dot(inputTexel.rgb, inputTexel.rgb) == 0.0 ? textureLod(specularTexture, uv, 0.) : vec4(0.);
vec3 specularColor = specularTexel.rgb;
float rayLength = specularTexel.a;

// specular UV
vec2 specularUv = reprojectedUv;
if (rayLength != 0.0) {
    vec2 hitPointUv = reprojectHitPoint(worldPos, rayLength, uv, depth);

    if (validateReprojectedUV(hitPointUv, depth, worldPos, worldNormal)) specularUv = hitPointUv;
}

vec3 lastSpecular;
float specularAlpha = 1.0;

if (specularUv.x != -1.) {
    vec4 lastSpecularTexel = sampleReprojectedTexture(lastSpecularTexture, specularUv);

    lastSpecular = lastSpecularTexel.rgb;
    specularAlpha = max(1., lastSpecularTexel.a);

    // check if specular was sampled for this texel this frame
    if (dot(specularColor, specularColor) != 0.0) {
        specularAlpha++;
    } else {
        specularColor = lastSpecular;
    }

    temporalResolveMix = min(1. - 1. / specularAlpha, maxValue);

    float roughness = inputTexel.a;
    float glossines = max(0., 0.01 - roughness) / 0.01;
    temporalResolveMix *= 1. - glossines;
}

gSpecular = vec4(mix(specularColor, lastSpecular, specularUv.x != -1. ? temporalResolveMix : 0.), specularAlpha);

// specular moment
if (specularUv.x != -1.) {
    // if the specular UV is not equal to the reprojected UV then we reprojected the hit point and need different info for variance
    if (specularUv != reprojectedUv) {
        historyMoment.ba = textureLod(lastMomentTexture, specularUv, 0.).ba;
    }

    moment.b = luminance(gSpecular.rgb);
    moment.a = moment.b * moment.b;
} else {
    moment.ba = vec2(0., 10.);
}
#endif

// diffuse moment
if (reprojectedUv.x != -1.) {
    historyMoment = textureLod(lastMomentTexture, reprojectedUv, 0.);

#ifdef specularOnly
    moment.b = luminance(gDiffuse.rgb);
    moment.a = moment.b * moment.b;
#else
    moment.r = luminance(gDiffuse.rgb);
    moment.g = moment.r * moment.r;
#endif
} else {
#ifdef specularOnly
    moment.ba = vec2(0., 10.);
#else
    moment.rg = vec2(0., 10.);
#endif
}

float momentTemporalResolveMix = max(blend, 0.8);
gMoment = mix(moment, historyMoment, momentTemporalResolveMix);

// if (isReprojectedUvSpecularValid)
//     gSpecular.xyz = vec3(0., 1., 0.);
// else
//     gSpecular.xyz = vec3(0., 0., 0.);

// gDiffuse.xyz = didMove ? vec3(0., 1., 0.) : vec3(0., 0., 0.);

// float variance = max(0.0, gMoment.a - gMoment.b * gMoment.b);
// variance = abs(variance);
// gDiffuse.xyz = vec3(variance);
#define TRANSFORM_FACTOR 0.5

vec4 directLightTexel = textureLod(directLightTexture, vUv, 0.0);

bool isBackground = dot(depthTexel.rgb, depthTexel.rgb) == 0.0;

// if this texel belongs to the background
if (isBackground) {
    inputTexel = directLightTexel * TRANSFORM_FACTOR;
} else {
    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.0);

#ifdef reflectionsOnly
    const float diffuseInfluence = 1.0;
#else
    // float metalness = inputTexel.a;

    // float diffuseInfluence = mix(0.975, 0.9, metalness);
    float diffuseInfluence = 0.95;
#endif

    vec3 diffuseColor = diffuseTexel.rgb * diffuseInfluence + (1. - diffuseInfluence);
    inputTexel.rgb *= diffuseColor;

    inputTexel.rgb += directLightTexel.rgb * TRANSFORM_FACTOR;
}

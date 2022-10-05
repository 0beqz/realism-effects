#define TRANSFORM_FACTOR 0.1

vec4 directLightTexel = textureLod(directLightTexture, vUv, 0.0);

// if this texel belongs to the background
if (isBackground) {
    inputTexel = directLightTexel * TRANSFORM_FACTOR;
} else {
    float a = inputTexel.a;

    inputTexel = fxaa(inputTexel, vUv);

    inputTexel.a = a;

#ifdef reflectionsOnly
    inputTexel.rgb *= directLightTexel.rgb;
#else
    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.0);
    const float diffuseInfluence = 0.95;

    vec3 diffuseColor = diffuseTexel.rgb * diffuseInfluence + (1. - diffuseInfluence);
    inputTexel.rgb *= diffuseColor;

#endif

    inputTexel.rgb += directLightTexel.rgb * TRANSFORM_FACTOR;

    inputTexel.rgb = min(inputTexel.rgb, vec3(1.));
}

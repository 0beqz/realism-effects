#define TRANSFORM_FACTOR 0.1

vec4 directLightTexel = textureLod(directLightTexture, vUv, 0.0);

// if this texel belongs to the background
if (isBackground) {
    inputTexel = directLightTexel * TRANSFORM_FACTOR;
} else {
#ifdef reflectionsOnly
    inputTexel.rgb *= directLightTexel.rgb;
#else
    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.0);

    if (blur > 0.) {
        // allow blur for up to 16 frames for "new" pixels
        float maxFrames = alphaStep * 16.0;
        float intensity = (maxFrames - inputTexel.a) / maxFrames;

        if (intensity > 0.) {
            vec3 blurredReflectionsColor = textureLod(boxBlurTexture, vUv, 0.).rgb;

            inputTexel.rgb = mix(inputTexel.rgb, blurredReflectionsColor, blur * intensity);
        }
    }

    const float diffuseInfluence = 0.95;

    vec3 diffuseColor = diffuseTexel.rgb * diffuseInfluence + (1. - diffuseInfluence);
    inputTexel.rgb *= diffuseColor;

#endif

    inputTexel.rgb += directLightTexel.rgb * TRANSFORM_FACTOR;

    inputTexel.rgb = min(inputTexel.rgb, vec3(1.));
}

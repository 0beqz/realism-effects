#define TRANSFORM_FACTOR 0.1

vec4 directLightTexel = textureLod(directLightTexture, vUv, 0.0);

// if this texel belongs to the background
if (isBackground) {
    inputTexel = directLightTexel * TRANSFORM_FACTOR;
} else {
    vec4 up = texture(inputTexture, vUv + vec2(0, 1) * size);
    vec4 left = texture(inputTexture, vUv + vec2(-1, 0) * size);
    vec4 center = inputTexel;
    vec4 right = texture(inputTexture, vUv + vec2(1, 0) * size);
    vec4 down = texture(inputTexture, vUv + vec2(0, -1) * size);

    float SHARPEN_FACTOR = 0.275;

    float a = inputTexel.a;

    // reference: https://www.shadertoy.com/view/wsK3Wt
    inputTexel = (1.0 + 4.0 * SHARPEN_FACTOR) * center - SHARPEN_FACTOR * (up + left + right + down);
    inputTexel.rgb = max(inputTexel.rgb, vec3(0.));

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

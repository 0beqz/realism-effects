#define INV_TRANSFORM_FACTOR 1.0

uniform sampler2D inputTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = textureLod(inputTexture, vUv, 0.);
    vec3 ssgiClr = ssgiTexel.rgb * INV_TRANSFORM_FACTOR;

    // float variance = max(0.0, ssgiTexel.g - ssgiTexel.r * ssgiTexel.r);
    // ssgiClr = vec3(variance);

    outputColor = vec4(ssgiClr, 1.0);
}
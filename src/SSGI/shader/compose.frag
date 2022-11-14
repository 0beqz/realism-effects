#define INV_TRANSFORM_FACTOR 6.0

uniform sampler2D inputTexture;
uniform float intensity;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = textureLod(inputTexture, vUv, 0.);
    vec3 ssgiClr = ssgiTexel.rgb * INV_TRANSFORM_FACTOR * 0.5;

    // float variance = max(0.0, ssgiTexel.g - ssgiTexel.r * ssgiTexel.r);
    // ssgiClr = vec3(variance);

    if (ssgiTexel.a == 0.0) {
        ssgiClr = inputColor.rgb;
    } else {
        ssgiClr *= intensity;
    }

    outputColor = vec4(ssgiClr, 1.0);
}
uniform sampler2D inputTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = texture2D(inputTexture, vUv);
    vec3 ssgiClr = ssgiTexel.rgb;

    outputColor = vec4(ssgiClr, 1.0);
}
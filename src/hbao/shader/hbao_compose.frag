uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform float power;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float unpackedDepth = textureLod(depthTexture, uv, 0.).r;

    vec3 ao = unpackedDepth > 0.9999 ? vec3(1.0) : textureLod(inputTexture, uv, 0.0).rgb;
    vec3 color = pow(ao, vec3(power));

    outputColor = vec4(inputColor.rgb * color, inputColor.a);
}
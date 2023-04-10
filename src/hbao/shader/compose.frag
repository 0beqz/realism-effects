uniform sampler2D inputTexture;
uniform sampler2D depthTexture;

// source: https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec3 Decode(vec2 f) {
    f = f * 2.0 - 1.0;

    // https://twitter.com/Stubbesaurus/status/937994790553227264
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float unpackedDepth = textureLod(depthTexture, uv, 0.).r;

    vec3 ao = unpackedDepth > 0.9999 ? vec3(1.0) : (textureLod(inputTexture, uv, 0.0).rgb * 2. - 1.);
    // vec3 ao = unpackedDepth > 0.9999 ? vec3(1.0) : textureLod(inputTexture, uv, 0.0).bbb;
    // vec3 color = inputColor.rgb * ao;
    vec3 color = ao;

    outputColor = vec4(color, inputColor.a);
}
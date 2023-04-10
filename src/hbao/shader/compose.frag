uniform sampler2D inputTexture;
uniform sampler2D depthTexture;

// Returns +/- 1
vec2 signNotZero(vec2 v) {
    return vec2((v.x >= 0.0) ? +1.0 : -1.0, (v.y >= 0.0) ? +1.0 : -1.0);
}

// Assume normalized input. Output is on [-1, 1] for each component.
vec2 float32x3_to_oct(in vec3 v) {
    // Project the sphere onto the octahedron, and then onto the xy plane
    vec2 p = v.xy * (1.0 / (abs(v.x) + abs(v.y) + abs(v.z)));
    // Reflect the folds of the lower hemisphere over the diagonals
    return (v.z <= 0.0) ? ((1.0 - abs(p.yx)) * signNotZero(p)) : p;
}

vec3 oct_to_float32x3(vec2 e) {
    vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
    if (v.z < 0.) v.xy = (1.0 - abs(v.yx)) * signNotZero(v.xy);
    return normalize(v);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float unpackedDepth = textureLod(depthTexture, uv, 0.).r;

    vec3 ao = unpackedDepth > 0.9999 ? vec3(1.0) : oct_to_float32x3(textureLod(inputTexture, uv, 0.0).rg) * 2. - 1.;
    // vec3 ao = unpackedDepth > 0.9999 ? vec3(1.0) : textureLod(inputTexture, uv, 0.0).bbb;
    // vec3 color = inputColor.rgb * ao;
    vec3 color = ao;

    outputColor = vec4(color, inputColor.a);
}
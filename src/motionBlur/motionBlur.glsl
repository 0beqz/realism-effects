
uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform float intensity;
uniform float jitter;
uniform float time;
uniform float deltaTime;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    // skip background
    if (dot(velocity.xyz, velocity.xyz) == 0.0) {
        outputColor = inputColor;
        return;
    }

    // unpack velocity [0, 1] -> [-1, 1]
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    velocity.xy *= intensity / (60. * deltaTime);

    vec2 blueNoise = textureLod(blueNoiseTexture, (vUv + time) * blueNoiseRepeat, 0.).rg;

    vec3 motionBlurredColor;
    vec3 neighborColor;
    vec2 reprojectedUv;

    vec2 jitterOffset = jitter * velocity.xy * blueNoise / samplesFloat;

    // UVs will be centered around the target pixel (see http://john-chapman-graphics.blogspot.com/2013/01/per-object-motion-blur.html)
    vec2 startUv = vUv - velocity.xy * 0.5;
    vec2 endUv = vUv + velocity.xy * 0.5 + jitterOffset;

    startUv = max(vec2(0.), startUv);
    endUv = min(vec2(1.), endUv);

    for (int i = 0; i < samples; i++) {
        if (i == samples) {
            neighborColor = inputColor.rgb;
        } else {
            reprojectedUv = mix(startUv, endUv, float(i) / samplesFloat);
            neighborColor = textureLod(inputTexture, reprojectedUv, 0.0).rgb;
        }

        motionBlurredColor += neighborColor;
    }

    motionBlurredColor /= samplesFloat;

    outputColor = vec4(motionBlurredColor, inputColor.a);
}
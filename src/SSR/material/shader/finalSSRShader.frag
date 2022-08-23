#define MODE_DEFAULT             0
#define MODE_REFLECTIONS         1
#define MODE_RAW_REFLECTION      2
#define MODE_BLURRED_REFLECTIONS 3
#define MODE_INPUT               4
#define MODE_BLUR_MIX            5

#define FLOAT_EPSILON            0.00001
// #define USE_DIFFUSE

uniform sampler2D diffuseTexture;
uniform sampler2D reflectionsTexture;
uniform float power;
uniform float blur;

uniform float intensity;

// source: https://www.shadertoy.com/view/7d2SDD
/*
FAST APPROXIMATION OF https://www.shadertoy.com/view/3dd3Wr

[
This project did NOT use any code from the /\ above, I was creating this
whilst comparing its visuals to the above project
]

Boi if anybody uses this script you better not change the name of the function

By: Sir Bird / Zerofile

*/

#define SAMPLES               80    // HIGHER = NICER = SLOWER
#define DISTRIBUTION_BIAS     0.6   // between 0. and 1.
#define PIXEL_MULTIPLIER      1.5   // between 1. and 3. (keep low)
#define INVERSE_HUE_TOLERANCE 20.0  // (2. - 30.)

#define GOLDEN_ANGLE          2.3999632  // 3PI-sqrt(5)PI

#define pow(a, b)             pow(max(a, 0.), b)  // @morimea

mat2 sample2D = mat2(cos(GOLDEN_ANGLE), sin(GOLDEN_ANGLE), -sin(GOLDEN_ANGLE), cos(GOLDEN_ANGLE));

vec3 sirBirdDenoise(sampler2D imageTexture, vec3 sampleCenter, in vec2 uv, in vec2 imageResolution) {
    vec3 denoisedColor = vec3(0.);

    const float sampleRadius = sqrt(float(SAMPLES));
    const float sampleTrueRadius = 0.5 / (sampleRadius * sampleRadius);
    vec2 samplePixel = vec2(1.0 / imageResolution.x, 1.0 / imageResolution.y);
    vec3 sampleCenterNorm = normalize(sampleCenter);
    float sampleCenterSat = length(sampleCenter);

    float influenceSum = 0.0;
    float brightnessSum = 0.0;

    vec2 pixelRotated = vec2(0., 1.);

    for (float x = 0.0; x <= float(SAMPLES); x++) {
        pixelRotated *= sample2D;

        vec2 pixelOffset = PIXEL_MULTIPLIER * pixelRotated * sqrt(x) * 0.5;
        float pixelInfluence = 1.0 - sampleTrueRadius * pow(dot(pixelOffset, pixelOffset), DISTRIBUTION_BIAS);
        pixelOffset *= samplePixel;

        vec3 thisDenoisedColor =
            textureLod(imageTexture, uv + pixelOffset, 0.0).rgb;

        pixelInfluence *= pixelInfluence * pixelInfluence;
        /*
            HUE + SATURATION FILTER
        */
        pixelInfluence *=
            pow(0.5 + 0.5 * dot(sampleCenterNorm, normalize(thisDenoisedColor)), INVERSE_HUE_TOLERANCE) * pow(1.0 - abs(length(thisDenoisedColor) - length(sampleCenterSat)), 8.);

        influenceSum += pixelInfluence;
        denoisedColor += thisDenoisedColor * pixelInfluence;
    }

    return denoisedColor / influenceSum;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 reflectionsTexel = texture2D(reflectionsTexture, vUv);
    vec3 reflectionClr = reflectionsTexel.xyz;

    if (blur > 0. && reflectionsTexel.a <= 0.05) {
        ivec2 size = textureSize(reflectionsTexture, 0);

        vec3 blurredReflectionsColor = sirBirdDenoise(reflectionsTexture, reflectionClr, vUv, vec2(size.x, size.y));

        reflectionClr = mix(reflectionClr, blurredReflectionsColor.rgb, blur);
    }

    reflectionClr *= intensity;

#ifdef USE_DIFFUSE
    vec3 diffuseColor = LinearTosRGB(textureLod(diffuseTexture, vUv, 0.)).rgb;
    reflectionClr *= diffuseColor;
#endif

    if (power != 1.0) reflectionClr = pow(reflectionClr, vec3(power));

#if RENDER_MODE == MODE_DEFAULT
    outputColor = vec4(inputColor.rgb + reflectionClr, 1.0);
#endif

#if RENDER_MODE == MODE_REFLECTIONS
    outputColor = vec4(reflectionClr, 1.0);
#endif

#if RENDER_MODE == MODE_RAW_REFLECTION
    outputColor = vec4(reflectionsTexel.xyz, 1.0);
#endif

#if RENDER_MODE == MODE_BLURRED_REFLECTIONS
    outputColor = vec4(blurredReflectionsTexel.xyz, 1.0);
#endif

#if RENDER_MODE == MODE_INPUT
    outputColor = vec4(inputColor.xyz, 1.0);
#endif

#if RENDER_MODE == MODE_BLUR_MIX
    outputColor = vec4(vec3(blur), 1.0);
#endif
}
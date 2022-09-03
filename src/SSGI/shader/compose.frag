#define MODE_DEFAULT             0
#define MODE_REFLECTIONS         1
#define MODE_RAW_REFLECTION      2
#define MODE_BLURRED_REFLECTIONS 3
#define MODE_INPUT               4
#define MODE_BLUR_MIX            5

#define FLOAT_EPSILON            0.00001
#define USE_DIFFUSE

uniform sampler2D diffuseTexture;
uniform sampler2D ssgiTexture;
uniform sampler2D boxBlurTexture;
uniform float intensity;
uniform float blur;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = texture2D(ssgiTexture, vUv);
    vec3 ssgiClr = ssgiTexel.xyz;

#if RENDER_MODE == MODE_DEFAULT
    outputColor = vec4(ssgiTexel.rgb, 1.0);
#endif

#if RENDER_MODE == MODE_REFLECTIONS
    outputColor = vec4(ssgiClr, 1.0);
#endif

#if RENDER_MODE == MODE_RAW_REFLECTION
    outputColor = vec4(ssgiTexel.xyz, 1.0);
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
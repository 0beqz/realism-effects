#define MODE_DEFAULT        0
#define MODE_REFLECTIONS    1
#define MODE_RAW_REFLECTION 2
#define MODE_INPUT          3

#define FLOAT_EPSILON       0.00001
#define USE_DIFFUSE

uniform sampler2D ssgiTexture;
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

#if RENDER_MODE == MODE_INPUT
    outputColor = vec4(inputColor.xyz, 1.0);
#endif
}
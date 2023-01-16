
uniform sampler2D inputTexture;
uniform sampler2D sceneTexture;
uniform sampler2D depthTexture;
uniform int toneMapping;

#include <tonemapping_pars_fragment>

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = textureLod(inputTexture, vUv, 0.);
    vec3 ssgiClr = ssgiTexel.rgb;

    switch (toneMapping) {
        case 1:
            ssgiClr = LinearToneMapping(ssgiClr);
            break;

        case 2:
            ssgiClr = ReinhardToneMapping(ssgiClr);
            break;

        case 3:
            ssgiClr = OptimizedCineonToneMapping(ssgiClr);
            break;

        case 4:
            ssgiClr = ACESFilmicToneMapping(ssgiClr);
            break;

        case 5:
            ssgiClr = CustomToneMapping(ssgiClr);
            break;
    }

    ssgiClr *= toneMappingExposure;

    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        ssgiClr = textureLod(sceneTexture, vUv, 0.).rgb;
    }

    outputColor = vec4(ssgiClr, 1.0);
}

uniform sampler2D inputTexture;
uniform int toneMapping;

#include <tonemapping_pars_fragment>

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 ssgiTexel = textureLod(inputTexture, vUv, 0.);
    vec3 ssgiClr = ssgiTexel.rgb;

    // switch (toneMapping) {
    //     case 1:
    //         ssgiClr = LinearToneMapping(ssgiClr);
    //         break;

    //     case 2:
    //         ssgiClr = ReinhardToneMapping(ssgiClr);
    //         break;

    //     case 3:
    //         ssgiClr = OptimizedCineonToneMapping(ssgiClr);
    //         break;

    //     case 4:
    //         ssgiClr = ACESFilmicToneMapping(ssgiClr);
    //         break;

    //     case 5:
    //         ssgiClr = CustomToneMapping(ssgiClr);
    //         break;
    // }

    // ssgiClr *= toneMappingExposure;

    // if (ssgiTexel.a == 0.0) ssgiClr = inputColor.rgb;

    outputColor = vec4(ssgiClr, 1.0);
}
varying vec2 vUv;
uniform sampler2D inputTexture;
uniform sampler2D acculumatedTexture;
uniform float cameraNotMovedFrames;

void main() {
  vec4 color = linearToOutputTexel(textureLod(inputTexture, vUv, 0.));

  if (cameraNotMovedFrames == 0.) {
    gl_FragColor = color;
    return;
  }

  vec4 acculumatedColor = textureLod(acculumatedTexture, vUv, 0.);

  gl_FragColor = mix(acculumatedColor, color, 1. / (cameraNotMovedFrames + 1.));
}
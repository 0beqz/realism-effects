import glsl from "vite-plugin-glsl"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [glsl()],
	resolve: {
		alias: [
			{ find: "traa", replacement: "../src/index.js" },
			{ find: "three", replacement: __dirname + "/node_modules/three" },
			{ find: "postprocessing", replacement: __dirname + "/node_modules/postprocessing" }
		]
	}
})

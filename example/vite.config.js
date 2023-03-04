import path from "path"
import glsl from "vite-plugin-glsl"
import viteCompression from "vite-plugin-compression"
import { fileURLToPath } from "url"

const fileName = fileURLToPath(import.meta.url)
const dirName = path.dirname(fileName)

export default {
	plugins: [glsl.default(), viteCompression({ algorithm: "brotliCompress" })],
	resolve: {
		alias: [
			{ find: "three", replacement: dirName + "/node_modules/three" },
			{ find: "postprocessing", replacement: dirName + "/node_modules/postprocessing" }
		]
	},
	server: {
		fs: {
			allow: [".."]
		}
	}
}

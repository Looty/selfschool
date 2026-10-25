import { promises } from "./fs.js";

export const { lstat, readdir, readFile, rename, rm, writeFile } = promises;
export default promises;

// Mascot artwork. Drawn in SVG, shipped as PNG.
import type { ImageSourcePropType } from "react-native";
import type { SnarkLevel } from "./copy";

export const MASCOT_ART: Record<SnarkLevel, ImageSourcePropType> = {
  quokka: require("../../assets/mascots/quokka.png"),
  wombat: require("../../assets/mascots/wombat.png"),
  bin_chicken: require("../../assets/mascots/bin_chicken.png"),
  tassie_devil: require("../../assets/mascots/tassie_devil.png"),
};

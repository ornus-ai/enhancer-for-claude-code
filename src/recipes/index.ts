// Every feature recipe, in the order the engine applies them.
import { broomRecipe } from './broom.ts'
import { imagePreviewRecipe } from './imagePreview.ts'
import { quoteReplyRecipe } from './quoteReply.ts'
import { quoteToolsRecipe } from './quoteTools.ts'
import { rtlRecipe } from './rtl.ts'

export const RECIPES = [rtlRecipe, broomRecipe, quoteReplyRecipe, quoteToolsRecipe, imagePreviewRecipe] as const

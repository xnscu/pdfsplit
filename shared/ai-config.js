
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，精准识别并拆分每一道独立的题目。试卷页面的布局有可能是多栏，有可能是单栏。

**识别规则：**
1. 每一道题目的题号由1到2个阿拉伯数字加上英文句点构成，例如：1.、11.。
2. **排除和具体题目无关的区域**，**严禁**将“一、选择题”、“二、填空题”、“三、解答题”等板块大标题或“本大题共XX分”等试卷的说明文字包含进来。
3. **包含子题**：题目内部的子问题（如 (1), (2)或选项（A,B,C,D）属于当前主题号。
4. 多框：一些题目可能**跨栏**或**跨页**，此时它对应多个框（boxes_2d），第二个框开始标记ID="continuation"。
   框应尽可能少：当一道题既没有跨栏也没有跨页的时候，框数应为1. 如果出现了跨栏或跨页，按常理2个框即可（不会有题干超过一栏或一页的题）。
5. 一个框（含continuation框）只能包含一道题，不能包含多道题。

结构：
{
  "id": "题号字符串",
  "boxes_2d": [ [ymin, xmin, ymax, xmax], ... ]
}

`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "题号字符串，如 '1' 或 '13'。如果是跨页承接内容则设为 'continuation'。"
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "该题目的边界框列表 [ymin, xmin, ymax, xmax] (0-1000)。"
      }
    },
    required: ["id", "boxes_2d"]
  }
};

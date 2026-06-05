export default function remarkLean() {
  return (tree: any) => {
    visit(tree, "code", (node: any) => {
      if (node.lang === "lean") {
        node.value = `-- Processed by remark-lean\n${node.value}`;
      }
    });
  };
}

function visit(node: any, type: string, callback: (node: any) => void) {
  if (node.type === type) {
    callback(node);
  }
  if (node.children) {
    for (const child of node.children) {
      visit(child, type, callback);
    }
  }
}
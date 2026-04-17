I’ve reviewed the IDE functionality and the project types logic. Here are the **critical functional gaps and logical problems** I’ve identified in the current implementation:

### **1. Critical Data Persistence Gap (The "Reload" Problem)**
*   **Problem**: While the dashboard saves the *list* of projects, the **internal editor state (the tree of screens and folders) is not persisted.**
*   **Result**: If a user adds 5 screens to a "Website" project and refreshes the browser, the project resets to the empty "Bootstrap" state. 
*   **Gap**: There is no code in `ProjectEditorPage` that writes the `tree` state back to `localStorage` or a database.

### **2. Interaction Friction in "Empty Folder" Types**
*   **Context**: Website, Logo, and Practice types start with empty folders.
*   **Problem**: The "First Selection" is a folder (`activeId` = Folder ID), but the workspace focus is a single artboard. When a folder is selected, the workspace currently shows a **static text message** ("Use the + button...").
*   **Recommended Fix**: For these types, the workspace focus should probably be a **"Empty State CTA"** (a large button in the workspace center to "Add First Screen") rather than just showing text in a corner. It feels broken to have a large empty workspace with no immediate action.

### **3. Naming & Deletion Gaps (The "Lock-in" Problem)**
*   **Problem**: There is no UI in the sidebar to rename or delete screens/folders.
*   **Gap**: `lib/editor-project.ts` contains `renameNodeById` and `removeNodeById` functions, but they are **orphaned**. They aren't connected to any button or context menu in the IDE.

### **4. "Practice" Type: Logic Divergence**
*   **Problem**: The "Practice" type is the only one that uses `ResizablePanelGroup` to show two columns.
*   **Logic Gap**: If a user selects a screen in the sidebar, the Sidebar's `activeId` changes. However, if the user is in "Practice" mode, they might expect the workspace to highlight *that specific screen* in the split-view, but the split-view currently acts as a "Gallery" of all desktop/mobile screens simultaneously. This creates a confusing **double-selection state**: "Which screen am I actually editing?"

### **5. Sidebar Hierarchy Restrictions**
*   **Problem**: The `handleHeaderPlus` (the big "+" at the top of the sidebar) is disabled for Website, Practice, and Logo types via a toast: `"Use + next to a folder to add a screen."`
*   **Result**: This feels like a "dead button" to the user.
*   **Logical Fix**: It should intelligently add to the *currently selected folder*, or default to the first folder (e.g., "Desktop view") if none is selected, instead of blocking the action.

### **6. Asset/File Management Gap**
*   **Table Requirement**: "Website" starts with "Desktop + Mobile folders, empty".
*   **Current Code**: It creates the folders, but the logic in `appendScreenToFolder` for "Website" is a bit rigid:
    ```tsx
    if (projectKind === "website design" || projectKind === "practice") {
      name = frame === "mobile" ? `Mobile ${screenCount}` : `Desktop ${screenCount}`;
    }
    ```
*   **Gap**: There's no way to move a screen from Desktop to Mobile or vice versa if the user accidentally adds it to the wrong folder.

### **Immediate Priorities for the IDE:**
1.  **Implement Tree Persistence**: Save the `tree` and `activeId` to `localStorage` keyed by `projectId`.
2.  **Interactive Empty States**: Replace the "Use + to add" text with a functional "Add Screen" artboard placeholder in the workspace.
3.  **Enable Sidebar Context Actions**: Add a "Rename" and "Delete" button (trash icon) to the sidebar tree nodes.
4.  **Smart Sidebar "+"**: Make the main sidebar "+" button work for all types by adding to the best-fit folder.


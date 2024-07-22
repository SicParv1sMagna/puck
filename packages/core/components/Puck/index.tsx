import {
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { DragStart, DragUpdate } from "@measured/dnd";

import type { AppState, Config, Data, UiState } from "../../types/Config";
import { Button } from "../Button";

import { Plugin } from "../../types/Plugin";
import { usePlaceholderStyle } from "../../lib/use-placeholder-style";

import { SidebarSection } from "../SidebarSection";
import {
  ChevronDown,
  ChevronUp,
  Globe,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { Heading } from "../Heading";
import { IconButton } from "../IconButton/IconButton";
import { DropZoneProvider } from "../DropZone";
import { ItemSelector, getItem } from "../../lib/get-item";
import { PuckAction, StateReducer, createReducer } from "../../reducer";
import { flushZones } from "../../lib/flush-zones";
import getClassNameFactory from "../../lib/get-class-name-factory";
import { AppProvider, defaultAppState } from "./context";
import { useResolvedData } from "../../lib/use-resolved-data";
import { MenuBar } from "../MenuBar";
import styles from "./styles.module.css";
import { Fields } from "./components/Fields";
import { Components } from "./components/Components";
import { Preview } from "./components/Preview";
import { Outline } from "./components/Outline";
import { Overrides } from "../../types/Overrides";
import { loadOverrides } from "../../lib/load-overrides";
import { usePuckHistory } from "../../lib/use-puck-history";
import { useHistoryStore, type History } from "../../lib/use-history-store";
import { Canvas } from "./components/Canvas";
import { defaultViewports } from "../ViewportControls/default-viewports";
import { Viewports } from "../../types/Viewports";
import { DragDropContext } from "../DragDropContext";
import { IframeConfig } from "../../types/IframeConfig";
import { DragDropProvider, useDragDropManager } from "@dnd-kit/react";
import { DragDropManager, Feedback } from "@dnd-kit/dom";
import type { Draggable } from "@dnd-kit/dom";
import { setupZone } from "../../lib/setup-zone";
import { rootDroppableId } from "../../lib/root-droppable-id";
import { generateId } from "../../lib/generate-id";
import { useInjectGlobalCss } from "../../lib/use-inject-css";

const getClassName = getClassNameFactory("Puck", styles);
const getLayoutClassName = getClassNameFactory("PuckLayout", styles);

export function Puck<UserConfig extends Config = Config>({
  children,
  config,
  data: initialData = { content: [], root: {} },
  ui: initialUi,
  onChange,
  onPublish,
  plugins = [],
  overrides = {},
  renderHeader,
  renderHeaderActions,
  headerTitle,
  headerPath,
  viewports = defaultViewports,
  iframe = {
    enabled: true,
  },
  dnd,
  initialHistory,
}: {
  children?: ReactNode;
  config: UserConfig;
  data: Partial<Data>;
  ui?: Partial<UiState>;
  onChange?: (data: Data) => void;
  onPublish?: (data: Data) => void;
  plugins?: Plugin[];
  overrides?: Partial<Overrides>;
  renderHeader?: (props: {
    children: ReactNode;
    dispatch: (action: PuckAction) => void;
    state: AppState;
  }) => ReactElement;
  renderHeaderActions?: (props: {
    state: AppState;
    dispatch: (action: PuckAction) => void;
  }) => ReactElement;
  headerTitle?: string;
  headerPath?: string;
  viewports?: Viewports;
  iframe?: IframeConfig;
  dnd?: {
    disableAutoScroll?: boolean;
  };
  initialHistory?: {
    histories: History<any>[];
    index: number;
  };
}) {
  const historyStore = useHistoryStore(initialHistory);

  useInjectGlobalCss();

  const [reducer] = useState(() =>
    createReducer<UserConfig>({ config, record: historyStore.record })
  );

  const [initialAppState] = useState<AppState>(() => {
    const initial = { ...defaultAppState.ui, ...initialUi };

    let clientUiState: Partial<AppState["ui"]> = {};

    if (typeof window !== "undefined") {
      // Hide side bars on mobile
      if (window.matchMedia("(max-width: 638px)").matches) {
        clientUiState = {
          ...clientUiState,
          leftSideBarVisible: false,
          rightSideBarVisible: false,
        };
      }

      const viewportWidth = window.innerWidth;

      const viewportDifferences = Object.entries(viewports)
        .map(([key, value]) => ({
          key,
          diff: Math.abs(viewportWidth - value.width),
        }))
        .sort((a, b) => (a.diff > b.diff ? 1 : -1));

      const closestViewport = viewportDifferences[0].key;

      if (iframe.enabled) {
        clientUiState = {
          viewports: {
            ...initial.viewports,

            current: {
              ...initial.viewports.current,
              height:
                initialUi?.viewports?.current?.height ||
                viewports[closestViewport].height ||
                "auto",
              width:
                initialUi?.viewports?.current?.width ||
                viewports[closestViewport].width,
            },
          },
        };
      }
    }

    // DEPRECATED
    if (
      Object.keys(initialData?.root || {}).length > 0 &&
      !initialData?.root?.props
    ) {
      console.error(
        "Warning: Defining props on `root` is deprecated. Please use `root.props`, or republish this page to migrate automatically."
      );
    }

    // Deprecated
    const rootProps = initialData?.root?.props || initialData?.root || {};

    const defaultedRootProps = {
      ...config.root?.defaultProps,
      ...rootProps,
    };

    return {
      ...defaultAppState,
      data: {
        ...initialData,
        root: { ...initialData?.root, props: defaultedRootProps },
        content: initialData.content || [],
      },
      ui: {
        ...initial,
        ...clientUiState,
        // Store categories under componentList on state to allow render functions and plugins to modify
        componentList: config.categories
          ? Object.entries(config.categories).reduce(
              (acc, [categoryName, category]) => {
                return {
                  ...acc,
                  [categoryName]: {
                    title: category.title,
                    components: category.components,
                    expanded: category.defaultExpanded,
                    visible: category.visible,
                  },
                };
              },
              {}
            )
          : {},
      },
    };
  });

  const [appState, dispatch] = useReducer<StateReducer>(
    reducer,
    flushZones(initialAppState)
  );

  const { data, ui } = appState;

  console.log("data", data);

  const history = usePuckHistory({ dispatch, initialAppState, historyStore });

  const { resolveData, componentState } = useResolvedData(
    appState,
    config,
    dispatch
  );

  const [menuOpen, setMenuOpen] = useState(false);

  const { itemSelector, leftSideBarVisible, rightSideBarVisible } = ui;

  const setItemSelector = useCallback(
    (newItemSelector: ItemSelector | null) => {
      if (newItemSelector === itemSelector) return;

      dispatch({
        type: "setUi",
        ui: { itemSelector: newItemSelector },
        recordHistory: true,
      });
    },
    [itemSelector]
  );

  const selectedItem = itemSelector ? getItem(itemSelector, data) : null;

  useEffect(() => {
    if (onChange) onChange(data);
  }, [data]);

  const { onDragStartOrUpdate, placeholderStyle } = usePlaceholderStyle();

  const [draggedItem, setDraggedItem] = useState<Draggable | null>();
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // DEPRECATED
  const rootProps = data.root.props || data.root;

  const toggleSidebars = useCallback(
    (sidebar: "left" | "right") => {
      const widerViewport = window.matchMedia("(min-width: 638px)").matches;
      const sideBarVisible =
        sidebar === "left" ? leftSideBarVisible : rightSideBarVisible;
      const oppositeSideBar =
        sidebar === "left" ? "rightSideBarVisible" : "leftSideBarVisible";

      dispatch({
        type: "setUi",
        ui: {
          [`${sidebar}SideBarVisible`]: !sideBarVisible,
          ...(!widerViewport ? { [oppositeSideBar]: false } : {}),
        },
      });
    },
    [dispatch, leftSideBarVisible, rightSideBarVisible]
  );

  useEffect(() => {
    if (!window.matchMedia("(min-width: 638px)").matches) {
      dispatch({
        type: "setUi",
        ui: {
          leftSideBarVisible: false,
          rightSideBarVisible: false,
        },
      });
    }

    const handleResize = () => {
      if (!window.matchMedia("(min-width: 638px)").matches) {
        dispatch({
          type: "setUi",
          ui: (ui) => ({
            ...ui,
            ...(ui.rightSideBarVisible ? { leftSideBarVisible: false } : {}),
          }),
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const defaultRender = useMemo<
    React.FunctionComponent<{ children?: ReactNode }>
  >(() => {
    const PuckDefault = ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    );

    return PuckDefault;
  }, []);

  // DEPRECATED
  const defaultHeaderRender = useMemo(() => {
    if (renderHeader) {
      console.warn(
        "`renderHeader` is deprecated. Please use `overrides.header` and the `usePuck` hook instead"
      );

      const RenderHeader = ({ actions, ...props }) => {
        const Comp = renderHeader!;

        return (
          <Comp {...props} dispatch={dispatch} state={appState}>
            {actions}
          </Comp>
        );
      };

      return RenderHeader;
    }

    return defaultRender;
  }, [renderHeader]);

  // DEPRECATED
  const defaultHeaderActionsRender = useMemo(() => {
    if (renderHeaderActions) {
      console.warn(
        "`renderHeaderActions` is deprecated. Please use `overrides.headerActions` and the `usePuck` hook instead."
      );

      const RenderHeader = (props) => {
        const Comp = renderHeaderActions!;

        return <Comp {...props} dispatch={dispatch} state={appState}></Comp>;
      };

      return RenderHeader;
    }

    return defaultRender;
  }, [renderHeader]);

  // Load all plugins into the overrides
  const loadedOverrides = useMemo(() => {
    return loadOverrides({ overrides, plugins });
  }, [plugins]);

  const CustomPuck = useMemo(
    () => loadedOverrides.puck || defaultRender,
    [loadedOverrides]
  );

  const CustomHeader = useMemo(
    () => loadedOverrides.header || defaultHeaderRender,
    [loadedOverrides]
  );
  const CustomHeaderActions = useMemo(
    () => loadedOverrides.headerActions || defaultHeaderActionsRender,
    [loadedOverrides]
  );

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedComponentConfig =
    selectedItem && config.components[selectedItem.type];
  const selectedComponentLabel = selectedItem
    ? selectedComponentConfig?.["label"] ?? selectedItem.type.toString()
    : "";

  const [manager] = useState(new DragDropManager({ plugins: [Feedback] }));

  return (
    <div className={`Puck ${getClassName()}`}>
      <AppProvider
        value={{
          state: appState,
          dispatch,
          config,
          componentState,
          resolveData,
          plugins,
          overrides: loadedOverrides,
          history,
          viewports,
          iframe,
        }}
      >
        <DragDropProvider
          manager={manager}
          onDragStart={() => {
            console.log("drag start");
            setIsDragging(true);
          }}
          onDragEnd={(event) => {
            const { source, target } = event.operation;

            if (!target || !source) return;

            setDraggedItem(null);
            setIsDragging(false);

            console.log("onDragEnd", source, target);

            const isOverZone = target.id.toString().indexOf("zone:") === 0;

            let zone = source.data.group;
            let index = source.data.index;

            if (isOverZone) {
              zone = target.id.toString().replace("zone:", "");
              index = 0; // TODO place at end
            }

            // Remove placeholder prop from component and sync to history

            const item = getItem({ zone, index }, data);

            if (!item) return;

            const propsWithoutPlaceholder = {
              ...item.props,
            };

            if (item.props.__placeholder) {
              propsWithoutPlaceholder.id = generateId(item.type);

              delete propsWithoutPlaceholder["__placeholder"];
            }

            dispatch({
              type: "replace",
              destinationIndex: source.data.index,
              destinationZone: source.data.group,
              data: { ...item, props: propsWithoutPlaceholder },
            });
          }}
          onDragOver={(event) => {
            // Prevent the optimistic re-ordering
            event.preventDefault();

            // Drag end can sometimes trigger after drag
            if (!isDragging) return;

            const { source, target } = event.operation;

            if (!target || !source) return;

            console.log("onDragOver", source, target);

            let isNewComponent = source.data.type === "drawer";
            const isOverZone = target.id.toString().indexOf("zone:") === 0;

            let targetZone = target.data.group;
            let targetIndex = target.data.index;

            if (isOverZone) {
              targetZone = target.id.toString().replace("zone:", "");
              targetIndex = 0; // TODO place at end
            }

            if (isNewComponent) {
              dispatch({
                type: "insert",
                componentType: source.data.componentType,
                destinationIndex: targetIndex,
                destinationZone: targetZone,
                recordHistory: false,
                props: {
                  id: source.id.toString(),
                  __placeholder: true,
                },
              });
              // dispatch({
              //   type: "insert",
              //   componentType: source.id.toString(),
              //   destinationIndex: targetIndex,
              //   destinationZone: targetZone,
              //   id: source.id.toString(),
              //   recordHistory: false,
              // });
            } else if (source.data.group === targetZone) {
              dispatch({
                type: "reorder",
                sourceIndex: source.data.index,
                destinationIndex: targetIndex,
                destinationZone: targetZone,
                recordHistory: false,
              });
            } else {
              dispatch({
                type: "move",
                sourceZone: source.data.group,
                sourceIndex: source.data.index,
                destinationIndex: targetIndex,
                destinationZone: targetZone,
                recordHistory: false,
              });
            }
          }}
          onBeforeDragStart={(op) => {
            setDraggedItem(op.operation.source);
          }}
        >
          <DropZoneProvider
            value={{
              data,
              itemSelector,
              setItemSelector,
              config,
              dispatch,
              draggedItem,
              placeholderStyle,
              mode: "edit",
              areaId: "root",
              collisionPriority: 1,
            }}
          >
            <CustomPuck>
              {children || (
                <div
                  className={getLayoutClassName({
                    leftSideBarVisible,
                    menuOpen,
                    mounted,
                    rightSideBarVisible,
                  })}
                >
                  <div className={getLayoutClassName("inner")}>
                    <CustomHeader
                      actions={
                        <>
                          <CustomHeaderActions>
                            <Button
                              onClick={() => {
                                onPublish && onPublish(data);
                              }}
                              icon={<Globe size="14px" />}
                            >
                              Publish
                            </Button>
                          </CustomHeaderActions>
                        </>
                      }
                    >
                      <header className={getLayoutClassName("header")}>
                        <div className={getLayoutClassName("headerInner")}>
                          <div className={getLayoutClassName("headerToggle")}>
                            <div
                              className={getLayoutClassName(
                                "leftSideBarToggle"
                              )}
                            >
                              <IconButton
                                onClick={() => {
                                  toggleSidebars("left");
                                }}
                                title="Toggle left sidebar"
                              >
                                <PanelLeft focusable="false" />
                              </IconButton>
                            </div>
                            <div
                              className={getLayoutClassName(
                                "rightSideBarToggle"
                              )}
                            >
                              <IconButton
                                onClick={() => {
                                  toggleSidebars("right");
                                }}
                                title="Toggle right sidebar"
                              >
                                <PanelRight focusable="false" />
                              </IconButton>
                            </div>
                          </div>
                          <div className={getLayoutClassName("headerTitle")}>
                            <Heading rank={2} size="xs">
                              {headerTitle || rootProps.title || "Page"}
                              {headerPath && (
                                <>
                                  {" "}
                                  <code
                                    className={getLayoutClassName("headerPath")}
                                  >
                                    {headerPath}
                                  </code>
                                </>
                              )}
                            </Heading>
                          </div>
                          <div className={getLayoutClassName("headerTools")}>
                            <div className={getLayoutClassName("menuButton")}>
                              <IconButton
                                onClick={() => {
                                  return setMenuOpen(!menuOpen);
                                }}
                                title="Toggle menu bar"
                              >
                                {menuOpen ? (
                                  <ChevronUp focusable="false" />
                                ) : (
                                  <ChevronDown focusable="false" />
                                )}
                              </IconButton>
                            </div>
                            <MenuBar
                              appState={appState}
                              data={data}
                              dispatch={dispatch}
                              onPublish={onPublish}
                              menuOpen={menuOpen}
                              renderHeaderActions={() => (
                                <CustomHeaderActions>
                                  <Button
                                    onClick={() => {
                                      onPublish && onPublish(data);
                                    }}
                                    icon={<Globe size="14px" />}
                                  >
                                    Publish
                                  </Button>
                                </CustomHeaderActions>
                              )}
                              setMenuOpen={setMenuOpen}
                            />
                          </div>
                        </div>
                      </header>
                    </CustomHeader>
                    <div className={getLayoutClassName("leftSideBar")}>
                      <SidebarSection title="Components" noBorderTop>
                        <Components />
                      </SidebarSection>
                      <SidebarSection title="Outline">
                        <Outline />
                      </SidebarSection>
                    </div>
                    <Canvas />
                    <div className={getLayoutClassName("rightSideBar")}>
                      <SidebarSection
                        noPadding
                        noBorderTop
                        showBreadcrumbs
                        title={selectedItem ? selectedComponentLabel : "Page"}
                      >
                        <Fields />
                      </SidebarSection>
                    </div>
                  </div>
                </div>
              )}
            </CustomPuck>
          </DropZoneProvider>
        </DragDropProvider>
      </AppProvider>
      <div id="puck-portal-root" className={getClassName("portal")} />
    </div>
  );
}

Puck.Components = Components;
Puck.Fields = Fields;
Puck.Outline = Outline;
Puck.Preview = Preview;

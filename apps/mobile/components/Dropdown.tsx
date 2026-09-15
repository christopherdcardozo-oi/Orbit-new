// Replaces @react-native-picker/picker everywhere in the app.
//
// Why: on iOS, Picker has exactly one rendering mode — an always-visible
// inline spinning wheel (UIPickerView). There's no built-in "closed field
// that opens on tap" mode the way Android's Spinner works, so every iOS
// picker in the app permanently ate ~120-216pt of vertical space and read
// as "a carousel", not a dropdown. Reported directly: "the carrosel to
// choose the drop down looks terrible... can it just be a drop down like
// the webapp?"
//
// This component is one closed, compact field (looks like a TextInput)
// that opens a real scrollable list in a modal sheet on tap — the same
// interaction shape on iOS, Android, and web, and the same shape the web
// build's native <select> already gives for free. No wheel, no native
// per-platform quirks to special-case.
import { useState } from 'react'
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, Pressable, Platform, ViewStyle, StyleProp } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Picker } from '@react-native-picker/picker'

export type DropdownItem = { label: string; value: string }

type Props = {
  value: string
  onValueChange: (value: string) => void
  items: DropdownItem[]
  placeholder?: string
  enabled?: boolean
  style?: StyleProp<ViewStyle>
  // Shown above the option list inside the sheet — e.g. "Select your university".
  title?: string
}

export default function Dropdown({ value, onValueChange, items, placeholder = 'Select…', enabled = true, style, title }: Props) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.value === value)

  // Web already gets a real browser <select> for free — react-native-web
  // maps Picker straight onto it, which is exactly the "dropdown like the
  // webapp" behavior being asked for elsewhere. No need to replace it here;
  // only iOS/Android's inline-wheel Picker needed replacing.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.field, style, !enabled && styles.disabled]}>
        <Picker
          selectedValue={value}
          onValueChange={(v) => onValueChange(String(v))}
          enabled={enabled}
          style={webSelectStyle}
        >
          {!selected && <Picker.Item label={placeholder} value="" />}
          {items.map((item) => (
            <Picker.Item key={item.value} label={item.label} value={item.value} />
          ))}
        </Picker>
        <Ionicons name="chevron-down" size={18} color="#9ca3af" style={styles.webCaret} pointerEvents="none" />
      </View>
    )
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.field, style, !enabled && styles.disabled]}
        onPress={() => enabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={selected ? selected.label : placeholder}
      >
        <Text style={[styles.fieldText, !selected && styles.placeholderText]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#9ca3af" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            {title && <Text style={styles.sheetTitle}>{title}</Text>}
            <FlatList
              data={items}
              keyExtractor={(item) => item.value}
              style={styles.list}
              // Caps the sheet's own scroll area — a real scroll, not a
              // wheel, but still bounded so a long list (e.g. every
              // campus) doesn't push the selected/checkmark row off
              // whatever screen height is left.
              showsVerticalScrollIndicator
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    onValueChange(item.value)
                    setOpen(false)
                  }}
                >
                  <Text style={[styles.optionText, item.value === value && styles.optionTextSelected]}>
                    {item.label}
                  </Text>
                  {item.value === value && <Ionicons name="checkmark" size={20} color="#c084fc" />}
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

// react-native-web renders Picker as a plain <select>: needs an explicit
// height/fontSize to match the field box, and no border of its own so it
// doesn't double up with styles.field's border.
const webSelectStyle = Platform.OS === 'web'
  ? { flex: 1, height: 46, backgroundColor: 'transparent', color: '#fff', fontSize: 16, borderWidth: 0, paddingRight: 28, appearance: 'none' as const, WebkitAppearance: 'none' as any }
  : {}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 16,
    height: 48,
  },
  disabled: {
    opacity: 0.5,
  },
  webCaret: {
    position: 'absolute',
    right: 14,
  },
  fieldText: {
    color: '#fff',
    fontSize: 16,
    flex: 1,
  },
  placeholderText: {
    color: '#6b7280',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 34, // clears the home-indicator area on notched iPhones
    maxHeight: '60%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionText: {
    color: '#e5e7eb',
    fontSize: 16,
    flex: 1,
  },
  optionTextSelected: {
    color: '#c084fc',
    fontWeight: '600',
  },
})

import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useColorScheme } from 'nativewind';
import { MoonStarIcon, SunIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';

export default function Screen() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        // A better check might be auth.getSession()
        const { error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        setIsConnected(true);
      } catch (e) {
        console.log('Supabase connection check failed:', e);
        setIsConnected(false);
      }
    };
    checkConnection();
  }, []);

  return (
    <View className="flex-1 items-center justify-center gap-5 bg-secondary/30 p-6">
      <View className="absolute right-6 top-12">
        <ThemeToggle />
      </View>
      <Text className="text-center text-3xl font-bold">{t('welcome')}</Text>

      <View className="rounded-lg border border-border bg-card p-4">
        <Text className="text-foreground">
          {isConnected ? t('supabase_connected') : t('supabase_not_connected')}
        </Text>
      </View>
    </View>
  );
}

function ThemeToggle() {
  const { colorScheme, toggleColorScheme } = useColorScheme();

  return (
    <Button onPress={toggleColorScheme} size="icon" variant="ghost" className="rounded-full">
      <Icon
        as={colorScheme === 'dark' ? MoonStarIcon : SunIcon}
        className="size-5 text-foreground"
      />
    </Button>
  );
}
